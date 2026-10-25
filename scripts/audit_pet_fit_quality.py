#!/usr/bin/env python3
"""Read-only fit provenance/numeric gate; never edits artwork or applies transforms.

Inputs:
 --collection: existing assets[] entries with id/path/sha256.
 --body-references: images[] with family_id/stage/original{path,sha256}.
 --fit-records (optional): schema_version1, records[]:
   {id, asset_id, asset_sha256, family_id, stage, body_sha256, slot,
    view_id, representation:2d|directional_2d|geometry_3d,
    angle:{yaw,pitch,roll},
    transform:{revision,scale:[sx,sy],offset_px:[x,y],rotation_deg},
    anchors:{asset:[u,v],body:[u,v]}, evidence:{geometry,rig,contact,visual},
    calibration:{approved:true,approval_id,basis_asset_sha256,basis_body_sha256,
      asset_anchor,body_anchor,asset_visible_bounds:[u0,v0,u1,v1],
      body_visible_bounds:[u0,v0,u1,v1],target_height_fraction,rotation_deg,
      validation_evidence:{path,sha256}}}
 Evidence is {path,sha256} to a schema1 JSON receipt bound to record_id,
 asset/body SHA, family/stage, slot, view_id and transform_sha256. It also
 needs kind=geometry|rig|contact|visual, result=pass, actual_render_observed=true.
 A geometry receipt additionally references mesh{path,sha256} and declares
 connected_volume=true/continuous_axes=[yaw,pitch,roll]. These are verified
 external receipts, not independent visual/3D inspection by this CLI.

approved/approval_id mean an existing technical validation and its ID, not
 a new request for human permission. validation_evidence must be a schema1
 numeric_calibration_validation receipt with result=pass,
 technical_validation_observed=true, validation_id, asset/body SHA and
 calibration_sha256=calibration_values_sha(calibration).

Egg eligibility is pending unless a SHA-bound runtime_eligibility receipt
 explicitly declares applicable or not_applicable. Other saved body stages
 are audit targets, not newly granted runtime unlocks. No planned bodies are
 invented. Old queue workflow status/completion/hold/retry fields survive;
 only current_audit determines current coverage. The CLI locks a derived-queue
 sidecar for its whole read/audit/write transaction. To update derived state
 in place, pass --previous-queue equal to --queue-output. Only that input role
 is replaceable; artwork, fit/evidence inputs and canonical lease/policy files
 remain protected. A concurrent run or stale previous queue is never reset.
 Numeric corrections are
 output candidates, always visual-pending, never renderer-applied.
"""
import argparse
import copy
from contextlib import contextmanager
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import stat
import sys
import tempfile

SCHEMA = 1
SLOTS = {"head", "torso", "feet", "hand", "floor", "seat", "surface", "interaction"}
REPRESENTATIONS = {"2d", "directional_2d", "geometry_3d"}
RESERVED_OUTPUTS = {"collection-manifest.json", "creation-queue.json",
                    "continuation-checkpoint.json", "creation-reservations.json",
                    "creative-lease.json", "work-unit-reservations.json", "creation-policy.json",
                    "automation-control.json", "owner-request.json", "growth-beyond-100-policy.json",
                    "edit-task-ledger.json"}
SHA = re.compile(r"[a-f0-9]{64}\Z")
IDENTIFIER = re.compile(r"[A-Za-z0-9_.:-]{1,180}\Z")


class AuditError(Exception):
    def __init__(self, code, context=""):
        super().__init__(code)
        self.code, self.context = code, context


def digest_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical_sha(value):
    return digest_bytes(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                   allow_nan=False).encode("utf-8"))


def number(value):
    try:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    except OverflowError:
        return False


def string_set(value):
    return set(value) if isinstance(value, list) and all(isinstance(v, str) for v in value) else set()


def queue_id_for(asset_id):
    stable = asset_id if len(asset_id) <= 150 else asset_id[:100] + ":" + digest_bytes(asset_id.encode())[:20]
    return "fit-quality:" + stable


def pair(value, normalized=False):
    return (isinstance(value, list) and len(value) == 2 and all(number(v) for v in value)
            and (not normalized or all(0 <= v <= 1 for v in value)))


def bounds(value):
    return (isinstance(value, list) and len(value) == 4 and all(number(v) for v in value)
            and 0 <= value[0] < value[2] <= 1 and 0 <= value[1] < value[3] <= 1)


def identifier(value, context):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise AuditError("invalid_identifier", context)
    return value


class ProtectedInputs(set):
    def __init__(self):
        super().__init__()
        self.roles = {}

    def remember(self, path, role):
        self.add(path)
        self.roles.setdefault(path, set()).add(role)


class Reader:
    def __init__(self):
        self.protected = ProtectedInputs()
        self.provenance = {}

    def bytes(self, path, context):
        try:
            p = Path(path).resolve()
            with p.open("rb") as handle:
                raw = handle.read(32 * 1024 * 1024 + 1)
            if len(raw) > 32 * 1024 * 1024:
                raise AuditError("input_size_limit", context)
        except (OSError, TypeError, ValueError):
            raise AuditError("read_failed", context)
        self.protected.remember(p, context)
        self.provenance[str(p)] = {"sha256": digest_bytes(raw), "bytes": len(raw)}
        return p, raw

    def json(self, path, context):
        p, raw = self.bytes(path, context)
        try:
            value = json.loads(raw.decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (UnicodeError, ValueError):
            raise AuditError("invalid_json", context)
        if not isinstance(value, dict):
            raise AuditError("invalid_object", context)
        return value

    def bound(self, reference, context, receipt=False):
        if (not isinstance(reference, dict) or not isinstance(reference.get("path"), str)
                or not isinstance(reference.get("sha256"), str) or not SHA.fullmatch(reference["sha256"])):
            raise AuditError("invalid_file_reference", context)
        path, raw = self.bytes(reference["path"], context)
        if digest_bytes(raw) != reference["sha256"]:
            raise AuditError("sha_mismatch", context)
        if not receipt:
            if len(raw) < 33 or raw[:8] != b"\x89PNG\r\n\x1a\n" or raw[12:16] != b"IHDR":
                raise AuditError("invalid_png_header", context)
            width, height = struct.unpack(">II", raw[16:24])
            if width <= 0 or height <= 0:
                raise AuditError("invalid_dimensions", context)
            return {"path": str(path), "sha256": reference["sha256"], "width": width, "height": height}
        try:
            value = json.loads(raw.decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        except (UnicodeError, ValueError):
            raise AuditError("invalid_receipt_json", context)
        if not isinstance(value, dict):
            raise AuditError("invalid_receipt_object", context)
        return value


def normalize_transform(value):
    if not isinstance(value, dict):
        return None, ["missing_transform"]
    reasons = []
    scale = value.get("scale")
    if number(scale):
        scale = [scale, scale]
    if not pair(scale) or any(v <= 0 for v in scale):
        reasons.append("invalid_positive_scale")
    elif not math.isclose(scale[0], scale[1], rel_tol=1e-9, abs_tol=1e-12):
        reasons.append("non_uniform_scale")
    offset = value.get("offset_px")
    if not pair(offset):
        reasons.append("invalid_offset")
    rotation = value.get("rotation_deg")
    if not number(rotation):
        reasons.append("invalid_rotation")
    revision = value.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        reasons.append("invalid_transform_revision")
    if reasons:
        return None, reasons
    return {"revision": revision, "scale": list(scale), "offset_px": list(offset),
            "rotation_deg": rotation}, []


def calibration_values_sha(calibration):
    keys = ["basis_asset_sha256", "basis_body_sha256", "asset_anchor", "body_anchor",
            "asset_visible_bounds", "body_visible_bounds", "target_height_fraction"]
    values = {key: calibration.get(key) for key in keys}
    values["rotation_deg"] = calibration.get("rotation_deg", 0)
    return canonical_sha(values)


def calibration_validation(reader, calibration, asset, body, record_id):
    reference = calibration.get("validation_evidence")
    if reference is None:
        return "missing_calibration_validation_evidence"
    proof = reader.bound(reference, "calibration:" + record_id, receipt=True)
    if (proof.get("schema_version") != SCHEMA or proof.get("kind") != "numeric_calibration_validation"
            or proof.get("result") != "pass" or proof.get("technical_validation_observed") is not True
            or proof.get("validation_id") != calibration["approval_id"]
            or proof.get("asset_sha256") != asset["sha256"] or proof.get("body_sha256") != body["sha256"]
            or proof.get("calibration_sha256") != calibration_values_sha(calibration)):
        return "unverified_calibration_validation_evidence"
    return None


def calculate_calibration(calibration, asset, body):
    if not isinstance(calibration, dict) or calibration.get("approved") is not True:
        return None, None
    if (not isinstance(calibration.get("approval_id"), str) or not calibration["approval_id"].strip()
            or calibration.get("basis_asset_sha256") != asset["sha256"]
            or calibration.get("basis_body_sha256") != body["sha256"]):
        return None, "calibration_approval_or_basis_missing"
    if (not pair(calibration.get("asset_anchor"), True) or not pair(calibration.get("body_anchor"), True)
            or not bounds(calibration.get("asset_visible_bounds"))
            or not bounds(calibration.get("body_visible_bounds"))
            or not number(calibration.get("target_height_fraction"))
            or calibration["target_height_fraction"] <= 0
            or not number(calibration.get("rotation_deg", 0))):
        return None, "invalid_calibration_numbers"
    aa, ba = calibration["asset_anchor"], calibration["body_anchor"]
    ab, bb = calibration["asset_visible_bounds"], calibration["body_visible_bounds"]
    rotation = calibration.get("rotation_deg", 0)
    radians = math.radians(rotation)
    aw = asset["width"] * (ab[2] - ab[0])
    ah = asset["height"] * (ab[3] - ab[1])
    rotated_height = abs(math.sin(radians)) * aw + abs(math.cos(radians)) * ah
    target_height = body["height"] * (bb[3] - bb[1]) * calibration["target_height_fraction"]
    scale = target_height / rotated_height
    ax, ay = asset["width"] * aa[0] * scale, asset["height"] * aa[1] * scale
    offset = [body["width"] * ba[0] - (ax * math.cos(radians) - ay * math.sin(radians)),
              body["height"] * ba[1] - (ax * math.sin(radians) + ay * math.cos(radians))]
    if not number(scale) or scale <= 0 or not pair(offset):
        return None, "invalid_calibration_result"
    return {"scale": [scale, scale], "offset_px": offset, "rotation_deg": rotation}, None


def evidence_check(reader, reference, kind, binding, issues):
    if reference is None:
        issues.append("missing_" + kind + "_evidence")
        return None
    value = reader.bound(reference, kind + ":" + binding["record_id"], receipt=True)
    if value.get("synthetic_fixture") is True:
        issues.append("synthetic_" + kind + "_evidence_not_fit_proof")
        return None
    if (value.get("schema_version") != SCHEMA or value.get("kind") != kind
            or value.get("result") != "pass" or value.get("actual_render_observed") is not True
            or any(value.get(key) != expected for key, expected in binding.items())):
        issues.append("unbound_or_unverified_" + kind + "_evidence")
        return None
    if kind == "geometry":
        if (value.get("connected_volume") is not True
                or not isinstance(value.get("continuous_axes"), list)
                or not {"yaw", "pitch", "roll"}.issubset(string_set(value["continuous_axes"]))):
            issues.append("incomplete_geometry_evidence")
            return None
        mesh = value.get("mesh")
        if not isinstance(mesh, dict) or not isinstance(mesh.get("path"), str):
            issues.append("missing_geometry_mesh")
            return None
        path, raw = reader.bytes(mesh["path"], "mesh:" + binding["record_id"])
        if (not isinstance(mesh.get("sha256"), str) or not SHA.fullmatch(mesh["sha256"])
                or digest_bytes(raw) != mesh["sha256"]):
            raise AuditError("sha_mismatch", "mesh:" + binding["record_id"])
        if path.suffix.lower() not in {".glb", ".gltf", ".obj", ".fbx"} or not raw:
            issues.append("invalid_geometry_mesh_reference")
            return None
    return value


def run_audit(collection_path, bodies_path, fit_records_path=None, previous_queue_path=None):
    reader = Reader()
    collection = reader.json(collection_path, "collection")
    body_input = reader.json(bodies_path, "body_references")
    if not isinstance(collection.get("assets"), list) or not isinstance(body_input.get("images"), list):
        raise AuditError("invalid_inventory_schema")
    assets, bodies = {}, {}
    for row in collection["assets"]:
        if not isinstance(row, dict):
            raise AuditError("invalid_asset")
        key = identifier(row.get("id"), "asset")
        if key in assets:
            raise AuditError("duplicate_asset", key)
        image = reader.bound({"path": row.get("path"), "sha256": row.get("sha256")}, "asset:" + key)
        declared = row.get("dimensions")
        if declared is not None and declared != [image["width"], image["height"]]:
            raise AuditError("declared_dimension_mismatch", key)
        assets[key] = dict(image, id=key, category=row.get("category"), name=row.get("name", row.get("name_ja", key)))
    for row in body_input["images"]:
        if not isinstance(row, dict):
            raise AuditError("invalid_body")
        family = identifier(row.get("family_id"), "family")
        stage = identifier(row.get("stage"), "stage")
        key = family + ":" + stage
        if key in bodies:
            raise AuditError("duplicate_body", key)
        image = reader.bound(row.get("original"), "body:" + key)
        declared = row["original"].get("PNG_dimensions")
        if declared is not None and declared != [image["width"], image["height"]]:
            raise AuditError("declared_dimension_mismatch", key)
        eligibility = "pending_eligibility" if stage == "egg" else "audit_target"
        if row.get("runtime_eligibility") is not None:
            proof = reader.bound(row["runtime_eligibility"], "eligibility:" + key, receipt=True)
            if (proof.get("schema_version") == SCHEMA and proof.get("kind") == "runtime_eligibility"
                    and proof.get("body_sha256") == image["sha256"] and proof.get("family_id") == family
                    and proof.get("stage") == stage and proof.get("state") in {"applicable", "not_applicable"}):
                eligibility = proof["state"]
        bodies[key] = dict(image, id=key, family_id=family, stage=stage, eligibility=eligibility)
    fits = {"schema_version": SCHEMA, "records": []}
    if fit_records_path is not None:
        fits = reader.json(fit_records_path, "fit_records")
    if fits.get("schema_version") != SCHEMA or not isinstance(fits.get("records"), list):
        raise AuditError("invalid_fit_schema")
    previous = {"schema_version": SCHEMA, "items": []}
    if previous_queue_path is not None:
        previous = reader.json(previous_queue_path, "previous_queue")
    if previous.get("schema_version") != SCHEMA or not isinstance(previous.get("items"), list):
        raise AuditError("invalid_queue_schema")
    previous_body_scope = previous.get("body_scope", {})
    if not isinstance(previous_body_scope, dict) or any(not isinstance(k, str) or not isinstance(v, str) or not SHA.fullmatch(v) for k, v in previous_body_scope.items()):
        raise AuditError("invalid_previous_body_scope")
    if any(key not in bodies for key in previous_body_scope):
        raise AuditError("body_reference_scope_shrunk")
    previous_items = {}
    for item in previous["items"]:
        if not isinstance(item, dict):
            raise AuditError("invalid_queue_item")
        key = identifier(item.get("id"), "queue")
        if key in previous_items:
            raise AuditError("duplicate_queue_item", key)
        previous_items[key] = copy.deepcopy(item)
    groups = {key: [] for key in assets}
    results, record_ids = [], set()
    histories = {key: copy.deepcopy(previous_items.get(queue_id_for(key), {}).get("calibration_revisions", [])) for key in assets}
    if any(not isinstance(value, list) for value in histories.values()):
        raise AuditError("invalid_calibration_history")
    for row in fits["records"]:
        if not isinstance(row, dict):
            raise AuditError("invalid_fit_record")
        record_id = identifier(row.get("id"), "fit_record")
        if record_id in record_ids:
            raise AuditError("duplicate_fit_record", record_id)
        record_ids.add(record_id)
        asset_id = identifier(row.get("asset_id"), record_id)
        family = identifier(row.get("family_id"), record_id)
        stage = identifier(row.get("stage"), record_id)
        body_id = family + ":" + stage
        if asset_id not in assets or body_id not in bodies:
            raise AuditError("unknown_asset_or_body", record_id)
        asset, body = assets[asset_id], bodies[body_id]
        issues = []
        for field, expected in [("asset_sha256", asset["sha256"]), ("body_sha256", body["sha256"])]:
            if field not in row:
                issues.append("missing_" + field)
            elif row[field] != expected:
                raise AuditError("sha_mismatch", record_id + ":" + field)
        slot, view_id = row.get("slot"), row.get("view_id")
        if not isinstance(slot, str) or slot not in SLOTS:
            issues.append("missing_or_invalid_slot")
        if not isinstance(view_id, str) or not IDENTIFIER.fullmatch(view_id):
            issues.append("missing_or_invalid_view_id")
        representation = row.get("representation")
        if not isinstance(representation, str) or representation not in REPRESENTATIONS:
            issues.append("missing_representation")
        angle = row.get("angle")
        if not isinstance(angle, dict) or not all(number(angle.get(axis)) for axis in ["yaw", "pitch", "roll"]):
            issues.append("missing_or_nonfinite_angle")
        transform, transform_issues = normalize_transform(row.get("transform"))
        anchors = row.get("anchors", {})
        anchor_issues = []
        if not isinstance(anchors, dict) or not pair(anchors.get("asset"), True) or not pair(anchors.get("body"), True):
            anchor_issues.append("missing_or_invalid_normalized_anchors")
        calibration, calibration_issue = calculate_calibration(row.get("calibration"), asset, body)
        if calibration is not None and body["eligibility"] not in {"audit_target", "applicable"}:
            calibration, calibration_issue = None, "calibration_waits_for_runtime_eligibility"
        if calibration is not None:
            calibration_issue = calibration_validation(reader, row["calibration"], asset, body, record_id)
            if calibration_issue:
                calibration = None
        if calibration_issue:
            issues.append(calibration_issue)
        correction = None
        if calibration is not None:
            signature = canonical_sha({"calibration": row["calibration"], "asset": asset, "body": body})
            old = None
            for candidate in histories[asset_id]:
                if not isinstance(candidate, dict) or candidate.get("record_id") != record_id or candidate.get("signature") != signature:
                    continue
                stored_transform, errors = normalize_transform(candidate.get("transform"))
                if (errors or candidate.get("basis_asset_sha256") != asset["sha256"]
                        or candidate.get("basis_body_sha256") != body["sha256"]
                        or candidate.get("status") != "numerically_calibrated_visual_pending"
                        or candidate.get("applied_to_renderer") is not False):
                    continue
                expected_numbers = dict(calibration, revision=stored_transform["revision"])
                if stored_transform == expected_numbers:
                    old = candidate
                    break
            if old is not None:
                correction = copy.deepcopy(old)
            else:
                versions = [v["transform"].get("revision", 0) for v in histories[asset_id] if isinstance(v, dict) and v.get("record_id") == record_id and isinstance(v.get("transform"), dict)]
                prior_revision = row.get("transform", {}).get("revision", 0) if isinstance(row.get("transform"), dict) else 0
                versions.append(prior_revision if isinstance(prior_revision, int) and not isinstance(prior_revision, bool) and prior_revision >= 0 else 0)
                revision = max([v for v in versions if isinstance(v, int) and not isinstance(v, bool)] + [0]) + 1
                correction = {"record_id": record_id, "signature": signature,
                              "status": "numerically_calibrated_visual_pending",
                              "approval_id": row["calibration"]["approval_id"],
                              "basis_asset_sha256": asset["sha256"], "basis_body_sha256": body["sha256"],
                              "prior_transform": copy.deepcopy(row.get("transform")),
                              "transform": dict(calibration, revision=revision),
                              "applied_to_renderer": False}
                histories[asset_id].append(correction)
            transform = correction["transform"]
            anchors = {"asset": row["calibration"]["asset_anchor"], "body": row["calibration"]["body_anchor"]}
            transform_issues, anchor_issues = [], []
        numeric_issues = transform_issues + anchor_issues
        issues.extend(numeric_issues)
        binding = {"record_id": record_id, "asset_sha256": asset["sha256"], "body_sha256": body["sha256"],
                   "family_id": family, "stage": stage, "slot": slot, "view_id": view_id,
                   "angle": angle, "representation": representation,
                   "transform_sha256": canonical_sha(transform) if transform else None}
        evidence = row.get("evidence", {})
        if not isinstance(evidence, dict):
            evidence = {}
        receipts = {}
        for kind in ["geometry", "rig", "contact", "visual"]:
            receipts[kind] = evidence_check(reader, evidence.get(kind), kind, binding, issues)
        if representation != "geometry_3d":
            issues.append("2d_or_directional_views_do_not_prove_full360")
        if body["eligibility"] == "pending_eligibility":
            issues.append("body_eligibility_pending")
        if body["eligibility"] == "not_applicable":
            issues.append("body_slot_not_applicable")
        if correction:
            issues.append("calibrated_transform_visual_review_pending")
        visual_bound = bool(receipts["visual"] and not correction and not numeric_issues)
        # Verify external provenance; the CLI does not itself inspect renders or mesh volume.
        full360_bound = bool(representation == "geometry_3d" and visual_bound and all(receipts.values())
                             and receipts["visual"].get("all_angles_observed") is True
                             and {"front", "back", "left", "right", "above", "below"}.issubset(
                                 string_set(receipts["visual"].get("observed_views", []))))
        result = {"id": record_id, "asset_id": asset_id, "body_id": body_id, "slot": slot,
                  "view_id": view_id, "representation": representation,
                  "body_eligibility": body["eligibility"],
                  "mechanical_status": "invalid" if numeric_issues else "valid",
                  "issues": sorted(set(issues)), "transform": transform,
                  "external_visual_receipt_verified": visual_bound,
                  "external_full360_receipts_bound": full360_bound,
                  "full360_independently_verified_by_this_audit": False,
                  "correction_candidate": correction}
        results.append(result)
        groups[asset_id].append(result)
    output_items, asset_coverage = [], []
    for key in sorted(assets):
        records = groups[key]
        covered = {r["body_id"] for r in records if r["mechanical_status"] == "valid"
                   and r["external_visual_receipt_verified"] and r["external_full360_receipts_bound"]
                   and bodies[r["body_id"]]["eligibility"] not in {"pending_eligibility", "not_applicable"}
                   and not any(issue.startswith(("missing_", "unbound_", "invalid_")) for issue in r["issues"])}
        eligible = sorted(k for k, v in bodies.items() if v["eligibility"] in {"audit_target", "applicable"})
        unknown = sorted(k for k, v in bodies.items() if v["eligibility"] == "pending_eligibility")
        not_applicable = sorted(k for k, v in bodies.items() if v["eligibility"] == "not_applicable")
        missing = sorted(set(eligible) - covered)
        reasons = sorted(set(issue for r in records for issue in r["issues"]))
        if not records:
            reasons.append("no_fit_records_for_asset")
        if missing:
            reasons.append("body_stage_angle_fit_evidence_missing")
        if unknown:
            reasons.append("runtime_eligibility_unconfirmed")
        assessment = {"asset_sha256": assets[key]["sha256"], "complete": not missing and not unknown and bool(eligible),
                      "missing_fit_body_ids": missing, "pending_eligibility_body_ids": unknown,
                      "not_applicable_body_ids": not_applicable, "covered_body_ids": sorted(covered),
                      "reasons": sorted(set(reasons)), "record_ids": sorted(r["id"] for r in records),
                      "numeric_correction_candidates": sum(r["correction_candidate"] is not None for r in records),
                      "real_corrections_applied": 0}
        queue_id = queue_id_for(key)
        item = copy.deepcopy(previous_items.pop(queue_id, {"id": queue_id, "asset_id": key, "status": "pending"}))
        if item.get("asset_id") != key:
            raise AuditError("queue_asset_identity_mismatch", queue_id)
        item["current_audit"] = assessment
        item["calibration_revisions"] = histories[key]
        item["historical_status_is_not_current_fit_pass"] = True
        output_items.append(item)
        asset_coverage.append(dict(assessment, asset_id=key))
    output_items.extend(previous_items.values())
    output_items.sort(key=lambda item: item["id"])
    report = {"schema_version": SCHEMA, "scope": "actual supplied saved originals and supplied body-reference subset only",
              "status": "evidence_bound" if asset_coverage and all(r["complete"] for r in asset_coverage) else "pending",
              "completed_fit_claim_from_old_queue_allowed": False,
              "inventory": {"asset_count": len(assets), "body_reference_count": len(bodies),
                            "body_reference_egg_count": sum(v["stage"] == "egg" for v in bodies.values()),
                            "legacy_runtime_outfits_included": 0,
                            "legacy_runtime_six_are_separate_scope": True,
                            "planned_growth_slots_counted_as_images": 0},
              "coverage": asset_coverage, "records": sorted(results, key=lambda r: r["id"]),
              "independent_visual_reviews_performed": 0, "full360_independently_verified": False,
              "real_asset_corrections_applied": 0, "provenance": reader.provenance}
    derived_queue = copy.deepcopy(previous)
    derived_queue["schema_version"] = SCHEMA
    derived_queue["scope"] = "derived per-asset fit-quality queue; current_audit is authoritative for current evidence"
    derived_queue["items"] = output_items
    derived_queue["body_scope"] = {key: bodies[key]["sha256"] for key in sorted(bodies)}
    return report, derived_queue, reader.protected


@contextmanager
def derived_queue_lock(queue_path):
    """Serialize only this gate's derived state, never the creative/parent lease."""
    path = Path(queue_path)
    if path.suffix != ".json" or path.name.lower() in RESERVED_OUTPUTS or path.is_symlink():
        raise AuditError("protected_output_path")
    descriptor = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        lock_path = path.with_name(path.name + ".fit-audit.lock")
        descriptor = os.open(str(lock_path), os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise AuditError("invalid_derived_queue_lock")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise AuditError("derived_queue_busy")
        yield
    except OSError:
        raise AuditError("derived_queue_lock_failed")
    finally:
        if descriptor is not None:
            os.close(descriptor)


def write_outputs(report_path, queue_path, report, queue, protected, controlled_previous_queue=None):
    paths = [Path(report_path), Path(queue_path)]
    resolved = [p.resolve() for p in paths]
    controlled = Path(controlled_previous_queue).resolve() if controlled_previous_queue is not None else None
    roles = getattr(protected, "roles", {})
    if controlled is not None and (controlled != resolved[1] or roles.get(controlled) != {"previous_queue"}):
        raise AuditError("protected_output_path")

    def exempt(index, source):
        return index == 1 and controlled is not None and source == controlled

    if (resolved[0] == resolved[1]
            or any((p in protected and not exempt(index, p)) or p.name.lower() in RESERVED_OUTPUTS or p.suffix != ".json"
                   for index, p in enumerate(resolved))
            or any(p.is_symlink() for p in paths)):
        raise AuditError("protected_output_path")
    try:
        if any(path.exists() and source.exists() and not exempt(index, source)
               and os.path.samefile(str(path), str(source))
               for index, path in enumerate(paths) for source in protected):
            raise AuditError("protected_output_path")
    except OSError:
        raise AuditError("protected_output_check_failed")
    payloads = [(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")
                for value in [report, queue]]
    old, staged, replaced = [], [], []
    try:
        for path, payload in zip(paths, payloads):
            path.parent.mkdir(parents=True, exist_ok=True)
            old_stat = path.stat() if path.exists() else None
            old.append({"bytes": path.read_bytes() if old_stat is not None else None, "stat": old_stat})
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
                handle.write(payload); handle.flush(); os.fsync(handle.fileno()); staged.append(Path(handle.name))
        for index, (temporary, path) in enumerate(zip(staged, paths)):
            os.replace(str(temporary), str(path)); replaced.append(index)
    except OSError:
        rollback_failed = False
        for index in replaced:
            saved = old[index]
            try:
                if saved["bytes"] is None:
                    if paths[index].exists():
                        paths[index].unlink()
                else:
                    paths[index].write_bytes(saved["bytes"])
                    os.chmod(paths[index], stat.S_IMODE(saved["stat"].st_mode))
                    os.utime(paths[index], ns=(saved["stat"].st_atime_ns, saved["stat"].st_mtime_ns))
            except OSError:
                rollback_failed = True
        raise AuditError("output_rollback_failed" if rollback_failed else "output_write_failed")
    finally:
        for temporary in staged:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--body-references", required=True)
    parser.add_argument("--fit-records")
    parser.add_argument("--previous-queue")
    parser.add_argument("--report-output", required=True)
    parser.add_argument("--queue-output", required=True)
    args = parser.parse_args(argv)
    try:
        with derived_queue_lock(args.queue_output):
            report, queue, protected = run_audit(args.collection, args.body_references, args.fit_records, args.previous_queue)
            output = Path(args.queue_output).resolve()
            previous = Path(args.previous_queue).resolve() if args.previous_queue is not None else None
            controlled = previous if previous == output else None
            if output.exists() and controlled is None:
                raise AuditError("existing_queue_requires_current_previous_queue")
            if controlled is not None:
                expected = report["provenance"].get(str(previous), {}).get("sha256")
                try:
                    actual = digest_bytes(previous.read_bytes())
                except OSError:
                    raise AuditError("derived_queue_changed_during_audit")
                if actual != expected:
                    raise AuditError("derived_queue_changed_during_audit")
            write_outputs(args.report_output, args.queue_output, report, queue, protected, controlled)
    except AuditError as error:
        print(json.dumps({"status": "input_or_output_error", "code": error.code, "context": error.context}), file=sys.stderr)
        return 2
    print(json.dumps({"status": report["status"], "assets": report["inventory"]["asset_count"],
                      "body_references": report["inventory"]["body_reference_count"],
                      "real_corrections_applied": 0}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
