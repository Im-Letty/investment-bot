#!/usr/bin/env python3
"""Offline reviewed-fact validator and backwards-compatible benefits JS builder.

No network, date inference, reviewer, or automatic publication is implemented here.
Existing nine records are immutable inputs; source review and deployment are separate.
"""
from __future__ import annotations

import argparse
import copy
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlsplit

LEGACY_SHA256 = "3fe65a4ffd3d10aa97cbb7acda85891055c3c72ca56cace417b0740051bf0a1c"
CODE = re.compile(r"[0-9][A-Z0-9]{3}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
JST = timezone(timedelta(hours=9))


class ValidationError(ValueError):
    """Fixed diagnostic codes only: never include raw source contents or URLs."""


def need(condition, code):
    if not condition:
        raise ValidationError(code)


def text(value, code, limit=2000):
    need(isinstance(value, str) and 0 < len(value.strip()) <= limit, code)
    need(not any(ord(char) < 32 and char not in "\n\t" for char in value), code)
    return value.strip()


def day(value, code, nullable=False):
    if value is None and nullable:
        return None
    need(isinstance(value, str) and bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)), code)
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValidationError(code) from None


def normalized_name(value):
    return "".join(unicodedata.normalize("NFKC", value).split())


def safe_url(value):
    text(value, "invalid_source_url", 2000)
    need(not re.search(r"[\x00-\x20\x7f\\]", value), "invalid_source_url")
    try:
        parsed = urlsplit(value)
        need(parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password,
             "invalid_source_url")
        need(parsed.port in (None, 443) and not parsed.fragment, "invalid_source_url")
    except ValueError:
        raise ValidationError("invalid_source_url") from None
    return value


def load_json(path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            need(key not in result, "duplicate_json_key")
            result[key] = value
        return result
    need(Path(path).stat().st_size <= 20 * 1024 * 1024, "input_too_large")
    return json.loads(Path(path).read_text(), object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValidationError("invalid_json_number")))


def load_legacy(path):
    payload = Path(path).read_bytes()
    need(hashlib.sha256(payload).hexdigest() == LEGACY_SHA256, "legacy_snapshot_changed")
    legacy = json.loads(payload)
    need(len(legacy) == 9 and len({row["code"] for row in legacy}) == 9, "legacy_snapshot_invalid")
    return legacy


def identities_from(document, as_of):
    need(isinstance(document, dict) and document.get("schema_version") == 1, "identity_schema")
    observed = day(document.get("as_of"), "identity_date")
    need(observed <= as_of, "future_identity_date")
    need(isinstance(document.get("items"), list) and 0 < len(document["items"]) <= 10000, "identity_items")
    identities = {}
    for item in document["items"]:
        need(isinstance(item, dict), "identity_row")
        code = item.get("code")
        need(isinstance(code, str) and bool(CODE.fullmatch(code)), "identity_code")
        need(code not in identities, "identity_duplicate_code")
        name = text(item.get("name"), "identity_name", 160)
        symbol = item.get("symbol")
        need(symbol in (code + ".T", code + ".JP"), "identity_symbol")
        identities[code] = {"code": code, "name": name, "symbol": symbol}
    return identities, observed.isoformat()


def validate_source(source, identity, verified, as_of, evidence_root):
    need(isinstance(source, dict), "source_missing")
    safe_url(source.get("url"))
    if "citation_url" in source:
        safe_url(source["citation_url"])
    text(source.get("title"), "source_title", 200)
    need(source.get("security_code") == identity["code"], "source_issuer_code")
    need(isinstance(source.get("issuer_name"), str) and
         normalized_name(source["issuer_name"]) == normalized_name(identity["name"]), "source_issuer_name")
    need(source.get("kind") == "issuer_primary", "source_not_primary")
    evidence_kind = source.get("evidence_kind", "primary_payload")
    need(evidence_kind in ("primary_payload", "primary_page_observation_note"), "source_evidence_kind")
    time_field = "fetched_at" if evidence_kind == "primary_payload" else "observed_at"
    fetched = source.get(time_field)
    need(isinstance(fetched, str), "source_fetch_time")
    try:
        captured = datetime.fromisoformat(fetched.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        raise ValidationError("source_fetch_time") from None
    need(captured.tzinfo is not None, "source_fetch_time")
    try:
        captured_day = captured.astimezone(JST).date()
    except (OverflowError, ValueError):
        raise ValidationError("source_fetch_time") from None
    need(captured_day <= verified <= as_of, "source_fetch_time")
    digest = source.get("evidence_sha256")
    need(isinstance(digest, str) and bool(SHA256.fullmatch(digest)), "source_evidence_sha")
    relative = source.get("evidence_path")
    need(isinstance(relative, str) and 0 < len(relative) <= 2000 and
         not any(ord(char) < 32 or ord(char) == 127 for char in relative), "source_evidence_path")
    need(not Path(relative).is_absolute(), "source_evidence_path")
    try:
        evidence_root = Path(evidence_root).resolve()
        proof = (evidence_root / relative).resolve()
    except (OSError, RuntimeError, ValueError):
        raise ValidationError("source_evidence_path") from None
    need(proof.is_relative_to(evidence_root) and proof.is_file(), "source_evidence_missing")
    need(proof.stat().st_size <= 10 * 1024 * 1024, "source_evidence_too_large")
    need(hashlib.sha256(proof.read_bytes()).hexdigest() == digest, "source_evidence_mismatch")


def validate_tiers(tiers):
    need(isinstance(tiers, list) and 0 < len(tiers) <= 60, "tiers_missing")
    ids = set()
    for tier in tiers:
        need(isinstance(tier, dict), "tier_invalid")
        need(all(key in tier for key in ("id", "shares_min", "shares_max", "holding_months_min",
                                        "holding_requirement", "reward", "conditions")), "tier_required_fields")
        key = text(tier.get("id"), "tier_id", 80)
        need(key not in ids, "tier_duplicate_id")
        ids.add(key)
        lower, upper = tier.get("shares_min"), tier.get("shares_max")
        need(type(lower) is int and 0 < lower <= 100000000, "tier_shares")
        need(upper is None or type(upper) is int and lower <= upper <= 100000000, "tier_shares")
        duration = tier.get("holding_months_min")
        need(duration is None or type(duration) is int and 0 <= duration <= 1200, "tier_holding_duration")
        text(tier.get("holding_requirement"), "tier_holding_requirement", 1000)
        text(tier.get("reward"), "tier_reward", 1000)
        text(tier.get("conditions"), "tier_conditions", 2000)


def validate_schedules(schedules, version, as_of):
    need(isinstance(schedules, list) and len(schedules) <= 30, "schedules_invalid")
    seen = set()
    start = day(version.get("effective_from"), "version_from", True)
    end = day(version.get("effective_until"), "version_until", True)
    for row in schedules:
        need(isinstance(row, dict), "schedule_row")
        deadline = day(row.get("date"), "schedule_deadline")
        record = day(row.get("record"), "schedule_record")
        ex = day(row.get("ex_dividend_date"), "schedule_ex_day")
        verified = day(row.get("verified"), "schedule_verified")
        need(deadline not in seen, "schedule_duplicate_deadline")
        seen.add(deadline)
        need(deadline < ex <= record and (record - deadline).days <= 15, "schedule_trade_order")
        need(verified <= as_of, "schedule_future_verified")
        need((start is None or record >= start) and (end is None or record <= end), "schedule_wrong_version")
        need(row.get("status") in ("planned", "confirmed"), "schedule_status")
        need(row.get("holding_basis") in ("basic_no_minimum_holding", "continuous_holding"), "schedule_holding_basis")
        if any(tier.get("holding_months_min") not in (None, 0) for tier in version["tiers"]):
            need(row.get("holding_basis") == "continuous_holding", "schedule_continuity_not_verified")
        safe_url(row.get("source"))
        for field in ("basis", "holdUntil", "holdExplanation", "grant", "delivery"):
            text(row.get(field), "schedule_" + field, 2000)


def validate_company(company, identities, as_of, evidence_root):
    need(isinstance(company, dict), "company_row")
    code = company.get("code")
    need(isinstance(code, str) and code in identities, "company_identity_missing")
    identity = identities[code]
    need(company.get("symbol") == identity["symbol"], "company_symbol_mismatch")
    need(isinstance(company.get("name"), str) and
         normalized_name(company["name"]) == normalized_name(identity["name"]), "company_name_mismatch")
    text(company.get("category"), "company_category", 80)
    if "aliases" in company:
        text(company["aliases"], "company_aliases", 500)
    versions = company.get("versions")
    need(isinstance(versions, list) and 0 < len(versions) <= 30, "versions_invalid")
    ids, intervals = set(), []
    for version in versions:
        need(isinstance(version, dict), "version_invalid")
        key = text(version.get("id"), "version_id", 80)
        need(key not in ids, "version_duplicate_id")
        ids.add(key)
        need(version.get("status") in ("active", "suspended", "abolished"), "version_status")
        start = day(version.get("effective_from"), "version_from", True)
        end = day(version.get("effective_until"), "version_until", True)
        need(start is None or end is None or start <= end, "version_interval")
        need(version["status"] == "active" or start is not None, "inactive_effective_date_required")
        intervals.append((start or date.min, end or date.max))
        verified = day(version.get("verified_on"), "version_verified")
        announced = day(version.get("announced_on"), "version_announced", True)
        need(verified <= as_of and (announced is None or announced <= verified), "version_future_review")
        review = version.get("review")
        need(isinstance(review, dict) and review.get("status") == "reviewed" and
             all(review.get(k) is True for k in ("issuer_identity", "programme_status", "eligibility", "future_changes")),
             "manual_review_incomplete")
        text(review.get("reviewed_by"), "reviewer_missing", 160)
        validate_source(version.get("source"), identity, verified, as_of, evidence_root)
        for field in ("period", "conditions", "use", "delivery"):
            text(version.get(field), "version_" + field, 3000)
        if "grant_summary" in version:
            text(version["grant_summary"], "version_grant_summary", 500)
        validate_tiers(version.get("tiers"))
        validate_schedules(version.get("schedules"), version, as_of)
    intervals.sort()
    need(all(previous[1] < current[0] for previous, current in zip(intervals, intervals[1:])), "version_intervals_overlap")


def shares_label(tier):
    return str(tier["shares_min"]) + ("株以上" if tier["shares_max"] is None else "〜" + str(tier["shares_max"]) + "株")


def project(company, version):
    """Keep all tiers explicit; the first tier is only the card summary."""
    first = version["tiers"][0]
    details = "\n".join(shares_label(tier) + " ／ " + tier["holding_requirement"] + "：" + tier["reward"] + "。" + tier["conditions"]
                        for tier in version["tiers"])
    # Inputs are the internal review manifest. Publish only factual presentation
    # fields: never copy reviewer names, local evidence paths, proof hashes,
    # transport metadata, or arbitrary unknown fields into the public asset.
    schedule_fields = ("date", "record", "ex_dividend_date", "verified", "status", "holding_basis", "source", "basis",
                       "holdUntil", "holdExplanation", "grant", "delivery")
    tier_fields = ("shares_min", "shares_max", "holding_months_min", "holding_requirement", "reward", "conditions")
    public_schedules = [{key: copy.deepcopy(schedule[key]) for key in schedule_fields} for schedule in version["schedules"]]
    public_tiers = [{key: copy.deepcopy(tier[key]) for key in tier_fields} for tier in version["tiers"]]
    citation_url = version["source"].get("citation_url", version["source"]["url"])
    public_source = {"url": citation_url, "title": version["source"]["title"], "verified_on": version["verified_on"]}
    row = {"code": company["code"], "symbol": company["symbol"], "name": company["name"],
           "category": company["category"], "reward": first["reward"], "shares": shares_label(first),
           "holding": first["holding_requirement"], "period": version["period"],
           "conditions": version["conditions"] + "\n" + details, "use": version["use"], "delivery": version["delivery"],
           "url": citation_url, "verified": version["verified_on"], "schedules": public_schedules,
           "programmeStatus": "active", "programmeVerified": version["verified_on"],
           "programmeEffectiveFrom": version.get("effective_from"), "programmeEffectiveUntil": version.get("effective_until"),
           "programmeSource": public_source, "tiers": public_tiers}
    if company.get("aliases"):
        row["aliases"] = company["aliases"]
    if "grant_summary" in version:
        row["grant"] = version["grant_summary"]
    return row


def build(legacy, additions, identity_document, as_of, evidence_root):
    need(type(as_of) is date, "as_of_invalid")
    need(isinstance(additions, dict) and additions.get("schema_version") == 1, "additions_schema")
    identities, identity_as_of = identities_from(identity_document, as_of)
    companies = additions.get("companies")
    need(isinstance(companies, list) and len(companies) <= 10000, "companies_invalid")
    base = copy.deepcopy(legacy)
    seen = {row["code"] for row in base}
    reviewed, withheld = [], []
    for company in companies:
        validate_company(company, identities, as_of, evidence_root)
        code = company["code"]
        need(code not in seen, "duplicate_or_legacy_company")
        seen.add(code)
        current = [version for version in company["versions"]
                   if (version.get("effective_from") is None or version["effective_from"] <= as_of.isoformat())
                   and (version.get("effective_until") is None or version["effective_until"] >= as_of.isoformat())]
        need(len(current) <= 1, "multiple_current_versions")
        if current and current[0]["status"] == "active":
            base.append(project(company, current[0]))
        else:
            reason = current[0]["status"] if current else ("future_effective" if all(
                version.get("effective_from") and version["effective_from"] > as_of.isoformat() for version in company["versions"])
                else "no_current_confirmed_version")
            withheld.append({"code": code, "reason": reason})
        reviewed.append(code)
    need(base[:len(legacy)] == legacy, "legacy_records_changed")
    report = {"schema_version": 1, "as_of_jst": as_of.isoformat(), "identity_as_of": identity_as_of,
              "identity_companies": len(identities), "legacy_preserved": len(legacy), "new_reviewed_companies": len(reviewed),
              "new_active_companies": len(base) - len(legacy), "published_total": len(base),
              "withheld": withheld, "unreviewed_identity_companies": len(set(identities) - seen),
              "all_company_coverage": False, "automatic_source_refresh": False,
              "no_benefit_inferred_from_missing_record": False, "calendar_dates_inferred": False,
              "manual_review_not_replaced_by_validator": True}
    return base, report


def render_js(rows):
    payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029").replace("<", "\\u003c")
    return "/* Generated offline from individually reviewed facts; coverage is partial. */\n(function(root,factory){const data=factory();if(typeof module==='object'&&module.exports)module.exports=data;if(root)root.KNBenefitsData=data;})(typeof window==='undefined'?null:window,function(){'use strict';return " + payload + ";});\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--legacy", type=Path, default=Path(__file__).resolve().parents[1] / "benefits-data" / "legacy-nine.json")
    parser.add_argument("--additions", type=Path, required=True)
    parser.add_argument("--identities", type=Path, required=True)
    parser.add_argument("--evidence-root", type=Path, required=True)
    parser.add_argument("--as-of", required=True, help="Actual JST review/publication day, YYYY-MM-DD")
    parser.add_argument("--output-dir", type=Path, required=True, help="Reviewed candidate output; never deploys")
    args = parser.parse_args()
    try:
        as_of = day(args.as_of, "as_of_invalid")
        now = datetime.now(timezone.utc)
        need(as_of <= now.astimezone(JST).date(), "future_build_date")
        additions = load_json(args.additions)
        rows, report = build(load_legacy(args.legacy), additions, load_json(args.identities), as_of, args.evidence_root)
        for company in additions["companies"]:
            for version in company["versions"]:
                source = version["source"]
                time_field = "observed_at" if source.get("evidence_kind") == "primary_page_observation_note" else "fetched_at"
                captured = datetime.fromisoformat(source[time_field].replace("Z", "+00:00"))
                need(captured <= now, "future_source_fetch_time")
        args.output_dir.mkdir(parents=True, exist_ok=True)
        (args.output_dir / "shareholder-benefits-data.js").write_text(render_js(rows))
        (args.output_dir / "build-verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    except (ValidationError, OSError, json.JSONDecodeError) as exc:
        code = str(exc) if isinstance(exc, ValidationError) else "input_or_output_unavailable"
        print(json.dumps({"ok": False, "reason": code}))
        return 2
    print(json.dumps({"ok": True, **report}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
