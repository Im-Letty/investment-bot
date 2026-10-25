"""Synthetic finite gate tests only; no real character fitting is attested."""
import contextlib
import copy
import fcntl
import os
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zlib

SCRIPT = Path(__file__).parents[1] / "scripts" / "audit_pet_fit_quality.py"
spec = importlib.util.spec_from_file_location("audit_pet_fit_quality", SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def png(path, width, height):
    def chunk(name, data):
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data) & 0xffffffff)
    pixels = (b"\x00" + b"\xf0\xdc\xc8\xff" * width) * height
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" +
                          chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) +
                          chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b""))


class Fixture:
    def __init__(self, root):
        self.root = Path(root)
        self.asset = self.root / "hat.png"
        png(self.asset, 20, 40)
        self.collection = self.root / "collection.json"
        self.bodies = self.root / "body-references.json"
        self.fits = self.root / "fit-records.json"
        self.previous = self.root / "previous.json"
        self.report = self.root / "report.json"
        self.queue = self.root / "derived-queue.json"
        self.write(self.collection, {"assets": [{"id": "hat_test_v1", "category": "clothing",
                                                "path": str(self.asset), "sha256": sha(self.asset),
                                                "dimensions": [20, 40]}]})
        self.refs = []
        for stage in ["adult", "baby", "egg"]:
            image = self.root / (stage + ".png")
            png(image, 100, 200)
            self.refs.append({"family_id": "milne", "stage": stage,
                              "original": {"path": str(image), "sha256": sha(image), "PNG_dimensions": [100, 200]}})
        self.write(self.bodies, {"images": self.refs})

    def write(self, path, value):
        Path(path).write_text(json.dumps(value, ensure_ascii=False) + "\n")
        return Path(path)

    def record(self, stage="adult"):
        body = next(v for v in self.refs if v["stage"] == stage)
        return {"id": "hat-milne-" + stage + "-front", "asset_id": "hat_test_v1",
                "asset_sha256": sha(self.asset), "family_id": "milne", "stage": stage,
                "body_sha256": body["original"]["sha256"], "slot": "head", "view_id": "front",
                "representation": "2d", "angle": {"yaw": 0, "pitch": 0, "roll": 0},
                "transform": {"revision": 3, "scale": [1, 1], "offset_px": [0, 0], "rotation_deg": 0},
                "anchors": {"asset": [0.5, 0], "body": [0.5, 0.25]}}

    def set_fits(self, records):
        self.write(self.fits, {"schema_version": 1, "records": records})

    def calibration(self, record):
        c = {"approved": True, "approval_id": "synthetic-technical-validation-1",
             "basis_asset_sha256": record["asset_sha256"], "basis_body_sha256": record["body_sha256"],
             "asset_anchor": [0.5, 0], "body_anchor": [0.5, 0.25],
             "asset_visible_bounds": [0, 0, 1, 1], "body_visible_bounds": [0, 0, 1, 1],
             "target_height_fraction": 0.5, "rotation_deg": 0}
        proof = {"schema_version": 1, "kind": "numeric_calibration_validation", "result": "pass",
                 "technical_validation_observed": True, "validation_id": c["approval_id"],
                 "asset_sha256": record["asset_sha256"], "body_sha256": record["body_sha256"],
                 "calibration_sha256": gate.calibration_values_sha(c),
                 "scope": "synthetic unit test numeric inputs only; no real artwork fitting"}
        path = self.write(self.root / ("validation-" + record["stage"] + ".json"), proof)
        c["validation_evidence"] = {"path": str(path), "sha256": sha(path)}
        return c

    def evidence(self, record, synthetic=False):
        transform, errors = gate.normalize_transform(record["transform"])
        assert not errors
        binding = {key: record[key] for key in ["asset_sha256", "body_sha256", "family_id", "stage", "slot", "view_id", "angle", "representation"]}
        binding.update(record_id=record["id"], transform_sha256=gate.canonical_sha(transform))
        evidence = {}
        for kind in ["geometry", "rig", "contact", "visual"]:
            proof = dict(binding, schema_version=1, kind=kind, result="pass", actual_render_observed=True,
                         synthetic_fixture=synthetic)
            if kind == "geometry":
                mesh = self.root / "synthetic.obj"
                mesh.write_text("v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 2 3\nf 1 4 2\nf 1 3 4\nf 2 4 3\n")
                proof.update(connected_volume=True, continuous_axes=["yaw", "pitch", "roll"],
                             mesh={"path": str(mesh), "sha256": sha(mesh)})
            if kind == "visual":
                proof.update(all_angles_observed=True, observed_views=["front", "back", "left", "right", "above", "below"])
            path = self.write(self.root / (kind + ".json"), proof)
            evidence[kind] = {"path": str(path), "sha256": sha(path)}
        return evidence

    def audit(self, records=None, previous=None):
        if records is not None:
            self.set_fits(records)
        if previous is not None:
            self.write(self.previous, previous)
        return gate.run_audit(self.collection, self.bodies,
                              self.fits if records is not None else None,
                              self.previous if previous is not None else None)

    def cli(self, records=True, previous=None):
        args = ["--collection", str(self.collection), "--body-references", str(self.bodies),
                "--report-output", str(self.report), "--queue-output", str(self.queue)]
        if records:
            args += ["--fit-records", str(self.fits)]
        if previous is not None:
            args += ["--previous-queue", str(previous)]
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return gate.main(args)


class FitQualityGateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.f = Fixture(self.temporary.name)

    def test_absent_fit_records_is_successful_pending_not_empty_or_pass(self):
        report, queue, _ = self.f.audit()
        self.assertEqual(report["status"], "pending")
        self.assertEqual(report["inventory"]["asset_count"], 1)
        self.assertEqual(report["inventory"]["body_reference_count"], 3)
        assessment = queue["items"][0]["current_audit"]
        self.assertEqual(assessment["missing_fit_body_ids"], ["milne:adult", "milne:baby"])
        self.assertEqual(assessment["pending_eligibility_body_ids"], ["milne:egg"])
        self.assertFalse(assessment["complete"])
        self.assertEqual(report["real_asset_corrections_applied"], 0)
        self.assertTrue(report["inventory"]["legacy_runtime_six_are_separate_scope"])
        self.assertEqual(report["inventory"]["legacy_runtime_outfits_included"], 0)
        self.assertEqual(self.f.cli(records=False), 0)

    def test_source_hash_failure_preserves_both_old_outputs(self):
        self.f.report.write_bytes(b"old report")
        self.f.queue.write_bytes(b"old queue")
        self.f.set_fits([])
        self.f.asset.write_bytes(self.f.asset.read_bytes() + b"changed")
        self.assertEqual(self.f.cli(), 2)
        self.assertEqual(self.f.report.read_bytes(), b"old report")
        self.assertEqual(self.f.queue.read_bytes(), b"old queue")

    def test_parse_read_and_body_sha_failures_never_replace_old_outputs(self):
        for mode in ["json", "missing", "body"]:
            with self.subTest(mode=mode):
                self.f.report.write_bytes(b"old report"); self.f.queue.write_bytes(b"old queue")
                self.f.set_fits([])
                if mode == "json":
                    self.f.fits.write_text("{")
                elif mode == "missing":
                    self.f.fits.unlink()
                else:
                    Path(self.f.refs[0]["original"]["path"]).write_bytes(b"wrong body bytes")
                self.assertEqual(self.f.cli(), 2)
                self.assertEqual(self.f.report.read_bytes(), b"old report")
                self.assertEqual(self.f.queue.read_bytes(), b"old queue")

    def test_actual_dimensions_are_positive_and_declared_values_are_bound(self):
        for mode in ["declared", "body_declared", "zero_source"]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                f = Fixture(tmp)
                if mode == "declared":
                    d = json.loads(f.collection.read_text()); d["assets"][0]["dimensions"] = [21, 40]; f.write(f.collection, d)
                elif mode == "body_declared":
                    f.refs[0]["original"]["PNG_dimensions"] = [0, 200]; f.write(f.bodies, {"images": f.refs})
                else:
                    raw = bytearray(f.asset.read_bytes()); raw[16:20] = struct.pack(">I", 0); f.asset.write_bytes(raw)
                    d = json.loads(f.collection.read_text()); d["assets"][0]["sha256"] = sha(f.asset); f.write(f.collection, d)
                with self.assertRaises(gate.AuditError):
                    f.audit()

    def test_old_completed_and_unsubstantiated_true_flags_cannot_make_current_fit_pass(self):
        row = self.f.record()
        row["anchors"] = {}
        row.update(fit_verified=True, full_360_verified=True, view_count=16)
        old = {"schema_version": 1, "items": [{"id": "fit-quality:hat_test_v1", "asset_id": "hat_test_v1",
                                              "status": "completed", "receipt": {"old": "keep exact"},
                                              "retry_after_jst": "2030-01-01T12:00:00+09:00",
                                              "hold_reason": "owner review"}]}
        report, queue, _ = self.f.audit([row], old)
        self.assertEqual(queue["items"][0]["status"], "completed")
        self.assertEqual(queue["items"][0]["receipt"], old["items"][0]["receipt"])
        self.assertEqual(queue["items"][0]["retry_after_jst"], old["items"][0]["retry_after_jst"])
        self.assertFalse(queue["items"][0]["current_audit"]["complete"])
        self.assertEqual(report["status"], "pending")
        self.assertIn("missing_or_invalid_normalized_anchors", report["records"][0]["issues"])
        self.assertIn("2d_or_directional_views_do_not_prove_full360", report["records"][0]["issues"])

    def test_nonfinite_nonpositive_nonuniform_and_out_of_range_values_are_pending(self):
        changes = [
            ("scale", [1, 2]), ("scale", [0, 0]), ("scale", [-1, -1]), ("scale", [True, True]),
            ("scale", [10 ** 400, 10 ** 400]), ("offset_px", ["NaN", 0]), ("rotation_deg", "Infinity")
        ]
        for key, value in changes:
            with self.subTest(key=key, value=str(value)[:30]):
                row = self.f.record(); row["transform"][key] = value
                report, _, _ = self.f.audit([row])
                self.assertEqual(report["records"][0]["mechanical_status"], "invalid")
                self.assertIsNone(report["records"][0]["correction_candidate"])
        row = self.f.record(); row["anchors"]["asset"] = [1.1, 0]
        report, _, _ = self.f.audit([row])
        self.assertIn("missing_or_invalid_normalized_anchors", report["records"][0]["issues"])
        row = self.f.record(); row["angle"]["yaw"] = "NaN"; row["slot"] = []; row["representation"] = []
        report, _, _ = self.f.audit([row])
        self.assertIn("missing_or_nonfinite_angle", report["records"][0]["issues"])
        self.assertFalse(report["records"][0]["external_full360_receipts_bound"])

    def test_record_sha_or_evidence_sha_mismatch_is_fatal(self):
        row = self.f.record(); row["body_sha256"] = "0" * 64
        with self.assertRaisesRegex(gate.AuditError, "sha_mismatch"):
            self.f.audit([row])
        row = self.f.record(); row["evidence"] = self.f.evidence(row)
        row["evidence"]["visual"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(gate.AuditError, "sha_mismatch"):
            self.f.audit([row])

    def test_supplied_body_family_stage_and_record_ids_must_be_real_and_unique(self):
        for mode in ["family", "stage", "asset", "duplicate"]:
            row = self.f.record()
            if mode == "family": row["family_id"] = "not-in-reference-list"
            if mode == "stage": row["stage"] = "unmade-growth-9999"
            if mode == "asset": row["asset_id"] = "unmade_hat"
            with self.subTest(mode=mode), self.assertRaises(gate.AuditError):
                self.f.audit([row, copy.deepcopy(row)] if mode == "duplicate" else [row])

    def test_approved_technical_calibration_produces_new_uniform_revision_not_applied_success(self):
        row = self.f.record(); row["transform"]["scale"] = [1, 2]
        row["calibration"] = self.f.calibration(row)
        original_asset, original_body = self.f.asset.read_bytes(), Path(self.f.refs[0]["original"]["path"]).read_bytes()
        report, queue, _ = self.f.audit([row])
        candidate = report["records"][0]["correction_candidate"]
        self.assertEqual(candidate["status"], "numerically_calibrated_visual_pending")
        self.assertEqual(candidate["transform"], {"revision": 4, "scale": [2.5, 2.5], "offset_px": [25.0, 50.0], "rotation_deg": 0})
        self.assertEqual(candidate["prior_transform"], row["transform"])
        self.assertFalse(candidate["applied_to_renderer"])
        self.assertFalse(report["records"][0]["external_visual_receipt_verified"])
        self.assertEqual(report["real_asset_corrections_applied"], 0)
        self.assertEqual(self.f.asset.read_bytes(), original_asset)
        self.assertEqual(Path(self.f.refs[0]["original"]["path"]).read_bytes(), original_body)
        self.assertEqual(len(queue["items"][0]["calibration_revisions"]), 1)

    def test_calibration_flag_alone_or_missing_basis_numbers_or_evidence_never_corrects(self):
        for mode in ["unapproved", "missing_basis", "bad_anchor", "zero_bounds", "missing_validation", "false_validation"]:
            row = self.f.record(); c = self.f.calibration(row)
            if mode == "unapproved": c["approved"] = False
            if mode == "missing_basis": c.pop("basis_body_sha256")
            if mode == "bad_anchor": c["body_anchor"] = [2, 0.2]
            if mode == "zero_bounds": c["asset_visible_bounds"] = [0, 0, 0, 1]
            if mode == "missing_validation": c.pop("validation_evidence")
            if mode == "false_validation":
                path = Path(c["validation_evidence"]["path"]); proof = json.loads(path.read_text()); proof["technical_validation_observed"] = False
                self.f.write(path, proof); c["validation_evidence"]["sha256"] = sha(path)
            row["calibration"] = c
            with self.subTest(mode=mode):
                report, queue, _ = self.f.audit([row])
                self.assertIsNone(report["records"][0]["correction_candidate"])
                self.assertEqual(queue["items"][0]["calibration_revisions"], [])

    def test_validation_is_bound_to_exact_numeric_calibration_and_not_human_permission(self):
        row = self.f.record(); row["calibration"] = self.f.calibration(row)
        row["calibration"]["target_height_fraction"] = 0.75
        report, _, _ = self.f.audit([row])
        self.assertIsNone(report["records"][0]["correction_candidate"])
        self.assertIn("unverified_calibration_validation_evidence", report["records"][0]["issues"])

    def test_egg_eligibility_is_pending_and_no_calibration_is_guessed(self):
        row = self.f.record("egg"); row["calibration"] = self.f.calibration(row)
        report, queue, _ = self.f.audit([row])
        self.assertEqual(report["records"][0]["body_eligibility"], "pending_eligibility")
        self.assertIsNone(report["records"][0]["correction_candidate"])
        self.assertEqual(queue["items"][0]["current_audit"]["pending_eligibility_body_ids"], ["milne:egg"])

    def test_sha_bound_runtime_receipt_can_mark_egg_not_applicable(self):
        ref = self.f.refs[2]
        proof = {"schema_version": 1, "kind": "runtime_eligibility", "family_id": "milne", "stage": "egg",
                 "body_sha256": ref["original"]["sha256"], "state": "not_applicable"}
        path = self.f.write(self.f.root / "eligibility.json", proof)
        ref["runtime_eligibility"] = {"path": str(path), "sha256": sha(path)}
        self.f.write(self.f.bodies, {"images": self.f.refs})
        report, queue, _ = self.f.audit()
        self.assertEqual(queue["items"][0]["current_audit"]["not_applicable_body_ids"], ["milne:egg"])
        self.assertEqual(queue["items"][0]["current_audit"]["pending_eligibility_body_ids"], [])
        self.assertEqual(report["status"], "pending")

    def test_16_direction_drawings_and_true_claim_never_become_full360(self):
        row = self.f.record(); row["representation"] = "directional_2d"; row["view_count"] = 16
        row["full_360_verified"] = True; row["evidence"] = self.f.evidence(row)
        report, _, _ = self.f.audit([row])
        self.assertFalse(report["records"][0]["external_full360_receipts_bound"])
        self.assertFalse(report["full360_independently_verified"])
        self.assertIn("2d_or_directional_views_do_not_prove_full360", report["records"][0]["issues"])

    def test_visual_receipt_is_bound_to_transform_and_actual_angle(self):
        for change in ["angle", "transform"]:
            row = self.f.record(); row["representation"] = "geometry_3d"; row["evidence"] = self.f.evidence(row)
            if change == "angle": row["angle"]["yaw"] = 90
            else: row["transform"]["offset_px"][0] = 1
            with self.subTest(change=change):
                report, _, _ = self.f.audit([row])
                self.assertFalse(report["records"][0]["external_visual_receipt_verified"])
                self.assertIn("unbound_or_unverified_visual_evidence", report["records"][0]["issues"])

    def test_calibration_invalidates_old_transform_visual_receipts_and_malformed_axis_claims_are_pending(self):
        row = self.f.record(); row["evidence"] = self.f.evidence(row); row["calibration"] = self.f.calibration(row)
        report, _, _ = self.f.audit([row])
        self.assertIn("unbound_or_unverified_visual_evidence", report["records"][0]["issues"])
        row = self.f.record(); row["evidence"] = self.f.evidence(row)
        path = Path(row["evidence"]["geometry"]["path"]); value = json.loads(path.read_text()); value["continuous_axes"] = [{}]
        self.f.write(path, value); row["evidence"]["geometry"]["sha256"] = sha(path)
        report, _, _ = self.f.audit([row])
        self.assertIn("incomplete_geometry_evidence", report["records"][0]["issues"])

    def test_idempotent_merge_retains_completed_hold_retry_unknown_fields_and_no_duplicate_revision(self):
        row = self.f.record(); row["calibration"] = self.f.calibration(row)
        previous = {"schema_version": 1, "owner_stop": False, "items": [
            {"id": "fit-quality:hat_test_v1", "asset_id": "hat_test_v1", "status": "held",
             "retry_after_jst": "2030-01-01T12:00:00+09:00", "hold_reason": "existing long wait",
             "completed_receipt": {"sha256": "a" * 64}, "custom": {"keep": [1, 2]}},
            {"id": "old-completed-unit", "status": "completed", "receipt": {"unaltered": True}}]}
        _, queue1, _ = self.f.audit([row], previous)
        self.f.write(self.f.previous, queue1)
        previous_bytes = self.f.previous.read_bytes()
        _, queue2, _ = gate.run_audit(self.f.collection, self.f.bodies, self.f.fits, self.f.previous)
        self.assertEqual(queue2, queue1)
        unit = next(x for x in queue2["items"] if x["id"] == "fit-quality:hat_test_v1")
        self.assertEqual(unit["status"], "held")
        self.assertEqual(unit["retry_after_jst"], "2030-01-01T12:00:00+09:00")
        self.assertEqual(unit["custom"], {"keep": [1, 2]})
        self.assertEqual(len(unit["calibration_revisions"]), 1)
        self.assertFalse(unit["current_audit"]["complete"])
        self.assertEqual(next(x for x in queue2["items"] if x["id"] == "old-completed-unit"), previous["items"][1])
        self.assertEqual(previous_bytes, self.f.previous.read_bytes(), "auditing and merging never rewrite the supplied prior queue")

    def test_forged_previous_transform_history_cannot_bypass_calculated_numbers(self):
        row = self.f.record(); row["calibration"] = self.f.calibration(row)
        _, queue, _ = self.f.audit([row])
        old = queue["items"][0]["calibration_revisions"][0]
        old["transform"]["scale"] = [99, 99]
        report, updated, _ = self.f.audit([row], queue)
        correction = report["records"][0]["correction_candidate"]
        self.assertEqual(correction["transform"]["scale"], [2.5, 2.5])
        self.assertEqual(correction["transform"]["revision"], 5)
        self.assertEqual(len(updated["items"][0]["calibration_revisions"]), 2)

    def test_future_body_reference_append_adds_pending_coverage_but_removal_is_not_silent(self):
        _, old_queue, _ = self.f.audit()
        path = self.f.root / "child.png"; png(path, 120, 240)
        self.f.refs.append({"family_id": "milne", "stage": "child", "original": {"path": str(path), "sha256": sha(path)}})
        self.f.write(self.f.bodies, {"images": self.f.refs})
        _, queue, _ = self.f.audit(previous=old_queue)
        self.assertIn("milne:child", queue["items"][0]["current_audit"]["missing_fit_body_ids"])
        self.f.write(self.f.bodies, {"images": self.f.refs[:2]})
        with self.assertRaisesRegex(gate.AuditError, "body_reference_scope_shrunk"):
            self.f.audit(previous=queue)

    def test_explicit_output_cannot_overwrite_inputs_originals_or_shared_canonical_names(self):
        report, queue, protected = self.f.audit()
        original = self.f.collection.read_bytes()
        for path in [self.f.collection, self.f.asset, self.f.root / "creation-queue.json", self.f.root / "Creation-Queue.json",
                     self.f.root / "work-unit-reservations.json", self.f.root / "creation-policy.json",
                     self.f.root / "automation-control.json"]:
            with self.subTest(path=path), self.assertRaisesRegex(gate.AuditError, "protected_output_path"):
                gate.write_outputs(path, self.f.queue, report, queue, protected)
        self.assertEqual(self.f.collection.read_bytes(), original)
        with self.assertRaises(gate.AuditError):
            gate.write_outputs(self.f.report, self.f.report, report, queue, protected)


    def test_explicit_synthetic_receipts_are_not_counted_as_actual_fit_evidence(self):
        row = self.f.record(); row["representation"] = "geometry_3d"
        row["evidence"] = self.f.evidence(row, synthetic=True)
        report, queue, _ = self.f.audit([row])
        self.assertFalse(report["records"][0]["external_visual_receipt_verified"])
        self.assertFalse(report["records"][0]["external_full360_receipts_bound"])
        self.assertIn("synthetic_visual_evidence_not_fit_proof", report["records"][0]["issues"])
        self.assertFalse(queue["items"][0]["current_audit"]["complete"])
        self.assertEqual(report["real_asset_corrections_applied"], 0)

    def test_actual_geometry_claim_without_a_bound_mesh_never_covers_fit(self):
        row = self.f.record(); row["representation"] = "geometry_3d"
        row["evidence"] = self.f.evidence(row)
        path = Path(row["evidence"]["geometry"]["path"])
        proof = json.loads(path.read_text()); proof.pop("mesh")
        self.f.write(path, proof); row["evidence"]["geometry"]["sha256"] = sha(path)
        report, _, _ = self.f.audit([row])
        self.assertIn("missing_geometry_mesh", report["records"][0]["issues"])
        self.assertFalse(report["records"][0]["external_full360_receipts_bound"])



    def test_cli_reserved_parent_lease_and_policy_targets_keep_existing_bytes_and_mtime(self):
        self.f.set_fits([])
        for name in ["work-unit-reservations.json", "creation-policy.json", "automation-control.json"]:
            target = self.f.root / name
            target.write_bytes(b"existing shared state must remain")
            before = (target.read_bytes(), target.stat().st_mtime_ns)
            args = ["--collection", str(self.f.collection), "--body-references", str(self.f.bodies),
                    "--fit-records", str(self.f.fits), "--report-output", str(self.f.report),
                    "--queue-output", str(target)]
            with self.subTest(name=name), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(gate.main(args), 2)
            self.assertEqual((target.read_bytes(), target.stat().st_mtime_ns), before)
            self.assertFalse(target.with_name(target.name + ".fit-audit.lock").exists())
            self.assertFalse(self.f.report.exists())

    def test_cli_repeat_in_place_is_idempotent_and_preserves_workflow_and_originals(self):
        row = self.f.record(); row["calibration"] = self.f.calibration(row)
        self.f.set_fits([row])
        originals = {str(p): (p.read_bytes(), p.stat().st_mtime_ns) for p in
                     [self.f.asset, self.f.collection, self.f.bodies] +
                     [Path(r["original"]["path"]) for r in self.f.refs]}
        self.assertEqual(self.f.cli(), 0)
        queue = json.loads(self.f.queue.read_text())
        queue["items"][0].update(status="held", retry_after_jst="2030-01-01T12:00:00+09:00",
                                 hold_reason="keep prior wait", completed_receipt={"old": "keep"})
        queue["items"].append({"id": "old-completed-unit", "status": "completed", "receipt": {"keep": True}})
        self.f.write(self.f.queue, queue)
        self.assertEqual(self.f.cli(previous=self.f.queue), 0)
        first = self.f.queue.read_bytes()
        result = json.loads(first); unit = next(x for x in result["items"] if x["id"] == "fit-quality:hat_test_v1")
        self.assertEqual(unit["status"], "held")
        self.assertEqual(unit["retry_after_jst"], "2030-01-01T12:00:00+09:00")
        self.assertEqual(unit["completed_receipt"], {"old": "keep"})
        self.assertEqual(len(unit["calibration_revisions"]), 1)
        self.assertFalse(unit["current_audit"]["complete"])
        self.assertEqual(self.f.cli(previous=self.f.queue), 0)
        self.assertEqual(self.f.queue.read_bytes(), first)
        for path, (raw, modified) in originals.items():
            self.assertEqual(Path(path).read_bytes(), raw)
            self.assertEqual(Path(path).stat().st_mtime_ns, modified)
        self.assertEqual(json.loads(self.f.report.read_text())["real_asset_corrections_applied"], 0)

    def test_cli_does_not_reset_existing_derived_queue_without_current_previous_input(self):
        self.f.set_fits([])
        self.assertEqual(self.f.cli(), 0)
        before = self.f.queue.read_bytes()
        report_before = self.f.report.read_bytes()
        self.assertEqual(self.f.cli(), 2)
        self.assertEqual(self.f.queue.read_bytes(), before)
        self.assertEqual(self.f.report.read_bytes(), report_before)

    def test_cli_conflicting_derived_queue_lock_does_not_read_then_overwrite_state(self):
        self.f.set_fits([]); self.assertEqual(self.f.cli(), 0)
        before = self.f.queue.read_bytes(); report_before = self.f.report.read_bytes()
        lock = self.f.queue.with_name(self.f.queue.name + ".fit-audit.lock")
        with lock.open("a+b") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.f.cli(previous=self.f.queue), 2)
        self.assertEqual(self.f.queue.read_bytes(), before)
        self.assertEqual(self.f.report.read_bytes(), report_before)
        self.assertEqual(self.f.cli(previous=self.f.queue), 0)

    def test_cli_stale_previous_state_is_detected_before_any_output_write(self):
        self.f.set_fits([]); self.assertEqual(self.f.cli(), 0)
        report_before = self.f.report.read_bytes()
        original = gate.run_audit
        changed = b""
        def third_party_write(*args, **kwargs):
            nonlocal changed
            result = original(*args, **kwargs)
            other = json.loads(self.f.queue.read_text()); other["external_hold"] = "retain"
            self.f.write(self.f.queue, other); changed = self.f.queue.read_bytes()
            return result
        with patch.object(gate, "run_audit", side_effect=third_party_write):
            self.assertEqual(self.f.cli(previous=self.f.queue), 2)
        self.assertEqual(self.f.queue.read_bytes(), changed)
        self.assertEqual(self.f.report.read_bytes(), report_before)

    def test_previous_queue_used_as_evidence_is_never_exempted_as_mutable_state(self):
        row = self.f.record(); row["evidence"] = self.f.evidence(row)
        proof = json.loads(Path(row["evidence"]["rig"]["path"]).read_text())
        proof.update(items=[], scope="external receipt doubles as prior state")
        self.f.write(self.f.queue, proof)
        row["evidence"]["rig"] = {"path": str(self.f.queue), "sha256": sha(self.f.queue)}
        self.f.set_fits([row]); self.f.report.write_bytes(b"prior report")
        queue_before = self.f.queue.read_bytes()
        self.assertEqual(self.f.cli(previous=self.f.queue), 2)
        self.assertEqual(self.f.queue.read_bytes(), queue_before)
        self.assertEqual(self.f.report.read_bytes(), b"prior report")

    def test_second_replace_failure_rolls_back_actual_replaced_report_bytes_and_mtime(self):
        report, queue, protected = self.f.audit()
        self.f.report.write_bytes(b"prior report"); self.f.queue.write_bytes(b"prior queue")
        prior = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in [self.f.report, self.f.queue]}
        replace = os.replace
        calls = 0
        def fail_second(source, target):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("synthetic second replace failure")
            return replace(source, target)
        with patch.object(gate.os, "replace", side_effect=fail_second):
            with self.assertRaisesRegex(gate.AuditError, "output_write_failed"):
                gate.write_outputs(self.f.report, self.f.queue, report, queue, protected)
        self.assertEqual(calls, 2)
        for path, (raw, modified) in prior.items():
            self.assertEqual(path.read_bytes(), raw)
            self.assertEqual(path.stat().st_mtime_ns, modified)

    def test_two_output_write_failure_retains_existing_report(self):
        report, queue, protected = self.f.audit()
        self.f.report.write_bytes(b"prior success")
        before = self.f.report.stat().st_mtime_ns
        self.f.queue.mkdir()
        with self.assertRaisesRegex(gate.AuditError, "output_write_failed"):
            gate.write_outputs(self.f.report, self.f.queue, report, queue, protected)
        self.assertEqual(self.f.report.read_bytes(), b"prior success")
        self.assertEqual(self.f.report.stat().st_mtime_ns, before)


if __name__ == "__main__":
    unittest.main()
