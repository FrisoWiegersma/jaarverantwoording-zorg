"""Presentation lifecycle, tenant isolation, consent, and trusted export boundary."""

import copy
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import digimv
import main
import presentations
import pymupdf
from fastapi.testclient import TestClient


class PresentationsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = patch.object(digimv, "DATA", Path(self.tmp.name))
        self.data.start()
        self.env = patch.dict(os.environ, {"PRESENTON_URL": "http://presenton", "PRESENTON_PASSWORD": "test-secret"})
        self.env.start()
        self.client = TestClient(main.app)
        self.alice = {"cf-access-authenticated-user-email": "alice"}
        self.bob = {"cf-access-authenticated-user-email": "bob"}
        doc = pymupdf.open()
        doc.new_page().insert_text((72, 72), "Example presentation")
        self.pdf = doc.tobytes()
        doc.close()
        self.remote_id = "12345678-1234-1234-1234-123456789012"
        self.calls = []
        self.deck = {
            "title": "Example",
            "slides": [
                {
                    "index": 0,
                    "id": self.remote_id,
                    "presentation": self.remote_id,
                    "layout": "test",
                    "layout_group": "general",
                    "content": {"title": "Example"},
                    "ui": {"id": "test", "components": []},
                }
            ],
        }
        self.backend = patch.object(presentations, "remote", side_effect=self.fake_remote)
        self.backend.start()

    def tearDown(self):
        self.client.close()
        self.backend.stop()
        self.env.stop()
        self.data.stop()
        self.tmp.cleanup()

    def fake_remote(self, path, data=None, **kwargs):
        self.calls.append((path, data))
        if path.endswith("/generate/async"):
            return {"id": "task-" + "a" * 64, "status": "pending"}
        if "/status/" in path:
            return {"status": "completed", "data": {"presentation_id": self.remote_id, "path": "http://presenton/app_data/exports/example.pptx"}}
        if path.endswith("/export"):
            return {"path": "/app_data/exports/example." + data["export_as"]}
        if path.endswith(".pdf"):
            return self.pdf
        if path.endswith(".pptx"):
            return b"PK\x03\x04test-pptx"
        if path.endswith("/slide/edit"):
            return {"id": "new-slide"}
        if path.endswith("/slide_update"):
            self.assertEqual(kwargs.get("method"), "PATCH")
            self.deck["slides"][data["slide"]["index"]] = copy.deepcopy(data["slide"])
            return data["slide"]
        if path.endswith("/presentation/update"):
            self.assertEqual(kwargs.get("method"), "PATCH")
            self.deck.update(slides=copy.deepcopy(data["slides"]), title=data["title"])
            return self.deck
        if path.endswith("/chat/message"):
            self.deck["slides"][0]["ui"]["components"] = [{"id": "added-component", "elements": []}]
            return {"tool_calls": ["addComponent"], "response": "Component added"}
        if path.endswith(self.remote_id):
            return copy.deepcopy(self.deck)
        raise AssertionError(path)

    def call(self, tool, arguments, **fields):
        return self.client.post("/plugins/presenton/call", headers=self.alice, json={"tool": tool, "arguments": arguments, **fields})

    def finish_edit(self, pid):
        for _ in range(100):
            result = self.call("get_presentation_async_job", {"presentation_id": pid})
            if result.json().get("status") != "pending":
                return result
            time.sleep(0.01)
        self.fail("Editor did not finish")

    def create(self, **fields):
        result = self.call("create_presentation", {"title": "Example", "content": "Verified examples", "_request_id": "test-request"}, **fields)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()["presentation_id"]

    def test_slow_editor_is_polled_without_parallel_fallbacks(self):
        pid = self.create()
        self.call("get_presentation_async_job", {"presentation_id": pid})
        entered, release = threading.Event(), threading.Event()
        original = presentations.perform_editor

        def slow_editor(row, args):
            entered.set()
            release.wait(3)
            return original(row, args)

        with patch.object(presentations, "perform_editor", side_effect=slow_editor) as worker:
            start = self.call("edit_presentation", {"presentation_id": pid, "prompt": "Add a component", "_request_id": "edit-once"})
            self.assertEqual(start.json()["status"], "pending")
            self.assertTrue(entered.wait(1))
            try:
                self.assertEqual(self.call("get_presentation_async_job", {"presentation_id": pid}).json()["status"], "pending")
                self.assertEqual(self.call("edit_slide", {"presentation_id": pid, "slide": 1, "prompt": "Fallback"}).status_code, 409)
                self.assertEqual(self.call("update_slide", {"presentation_id": pid, "slide": 1, "ui": {"components": []}}).status_code, 409)
            finally:
                release.set()
            finished = self.finish_edit(pid)
            self.assertEqual(finished.json()["status"], "completed")
            self.assertEqual(worker.call_count, 1)

    def test_visual_review_contains_pixels_and_detects_bad_layouts(self):
        pid = self.create()
        self.call("get_presentation_async_job", {"presentation_id": pid})
        self.deck["slides"][0]["index"] = 1
        self.deck["slides"][0]["ui"]["components"] = [
            {
                "elements": [
                    {"type": "image", "data": "/static/images/placeholder.jpg"},
                    {"type": "text", "name": "body", "font": {"size": 14}, "runs": [{"text": "Tiny text"}]},
                ]
            }
        ]
        response = self.call("review_presentation", {"presentation_id": pid})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual({i["problem"] for i in result["issues"]}, {"placeholder_images", "small_body_text", "no_visible_source_label"})
        import base64

        self.assertTrue(base64.b64decode(result["images"][0]["data"]).startswith(b"\xff\xd8"))
        self.assertEqual(self.call("review_presentation", {"presentation_id": pid, "slides": [99]}).status_code, 422)
        before = len(self.calls)
        forbidden = self.client.post("/plugins/presenton/call", headers=self.bob, json={"tool": "review_presentation", "arguments": {"presentation_id": pid}})
        self.assertEqual(forbidden.status_code, 404)
        self.assertEqual(len(self.calls), before)

    def test_builtin_and_creation_idempotency(self):
        plugins = self.client.get("/plugins", headers=self.alice).json()
        builtin = next(p for p in plugins if p["handle"] == "presenton")
        self.assertTrue(builtin["builtin"])
        self.assertNotIn("test-secret", json.dumps(plugins))
        self.assertEqual(builtin["url"], "")
        pid = self.create()
        self.assertEqual(self.create(), pid)
        self.assertEqual(sum(p.endswith("/generate/async") for p, _ in self.calls), 1)
        self.assertEqual(self.call("create_presentation", {"title": "", "content": "x"}).status_code, 422)
        self.assertEqual(self.client.get("/plugins").status_code, 401)

    def test_download_preview_edit_and_owner_boundary(self):
        pid = self.create()
        result = self.call("get_presentation_async_job", {"presentation_id": pid})
        self.assertEqual(result.status_code, 200, result.text)
        artifact = result.json()["artifact"]
        self.assertEqual(len(artifact["pages"]), 1)
        self.assertTrue(artifact["downloadUrl"].startswith("/digimv/"))
        for suffix in ("", "/file.pptx", "/file.pdf", "/pages/1"):
            path = f"/presentations/{pid}" + suffix
            good = self.client.get(path, headers=self.alice)
            self.assertEqual(good.status_code, 200)
            self.assertIn("no-store", good.headers["cache-control"])
            self.assertEqual(self.client.get(path, headers=self.bob).status_code, 404)
            self.assertEqual(self.client.get(path).status_code, 401)
        image = self.client.get(f"/presentations/{pid}/pages/1", headers=self.alice)
        self.assertTrue(image.content.startswith(b"\x89PNG"))
        self.assertEqual(self.client.get(f"/presentations/{pid}/pages/0", headers=self.alice).status_code, 404)
        before = len(self.calls)
        rejected = self.client.post(
            "/plugins/presenton/call", headers=self.bob, json={"tool": "edit_slide", "arguments": {"presentation_id": pid, "slide": 1, "prompt": "edit"}}
        )
        self.assertEqual(rejected.status_code, 404)
        self.assertEqual(len(self.calls), before)
        edited = self.call("edit_slide", {"presentation_id": pid, "slide": 1, "prompt": "Change title"})
        self.assertEqual(edited.status_code, 200, edited.text)
        edited = self.finish_edit(pid)
        self.assertNotEqual(edited.json()["artifact"]["thumbnailUrl"], artifact["thumbnailUrl"])
        files_on_disk = sorted(p.name for p in presentations.directory(pid).iterdir())
        rev = edited.json()["artifact"]["revision"]
        self.assertEqual(files_on_disk, [f"{rev}.pdf", f"{rev}.pptx"])

    def test_failed_async_edit_clears_after_synchronous_fix(self):
        pid = self.create()
        self.call("get_presentation_async_job", {"presentation_id": pid})
        with patch.object(presentations, "perform_editor", side_effect=RuntimeError("boom")):
            self.call("edit_presentation", {"presentation_id": pid, "prompt": "Fail"})
            failed = self.finish_edit(pid)
            self.assertEqual(failed.json()["status"], "error")
        fixed = self.call("update_slide", {"presentation_id": pid, "slide": 1, "ui": {"id": "fixed", "components": []}})
        self.assertEqual(fixed.status_code, 200)
        status = self.call("get_presentation_async_job", {"presentation_id": pid})
        self.assertEqual(status.json()["status"], "completed")

    def test_status_after_edit_does_not_restore_the_original_export(self):
        pid = self.create()
        self.call("get_presentation_async_job", {"presentation_id": pid})
        row = presentations.owned(pid, "alice")
        presentations.invalidate(row)
        before = len(self.calls)
        response = self.call("get_presentation_async_job", {"presentation_id": pid})
        self.assertEqual(response.status_code, 200, response.text)
        exports = [data["export_as"] for path, data in self.calls[before:] if path.endswith("/export")]
        self.assertEqual(exports, ["pptx", "pdf"])

    def test_project_consent_revokes_file_and_tool_access(self):
        p = self.client.post("/projects", headers=self.alice, json={"name": "Private", "allow_private": True}).json()
        pid = self.create(project_id=p["id"])
        self.assertEqual(self.call("get_presentation_async_job", {"presentation_id": pid}).status_code, 200)
        self.client.put("/projects/" + p["id"], headers=self.alice, json={"name": "Private", "allow_private": False})
        self.assertEqual(self.client.get(f"/presentations/{pid}/file.pptx", headers=self.alice).status_code, 403)
        self.assertEqual(self.call("get_presentation", {"presentation_id": pid}).status_code, 403)
        self.assertEqual(self.call("list_presentations", {}, project_id=p["id"]).status_code, 403)

    def test_full_control_structure_object_edits_and_undo(self):
        pid = self.create()
        self.call("get_presentation_async_job", {"presentation_id": pid})
        original = self.call("get_slide", {"presentation_id": pid, "slide": 1}).json()
        for action, fields, size in [
            ("duplicate", {"slide": 1}, 2),
            ("reorder", {"order": [2, 1]}, 2),
            ("add", {"position": 2}, 3),
            ("delete", {"slide": 1}, 2),
            ("rename", {"title": "Renamed"}, 2),
        ]:
            response = self.call("manage_slides", {"presentation_id": pid, "action": action, **fields})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["slides"], size)
        for _ in range(5):
            response = self.call("undo_edit", {"presentation_id": pid})
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.call("get_slide", {"presentation_id": pid, "slide": 1}).json(), original)
        self.assertEqual(self.call("undo_edit", {"presentation_id": pid}).status_code, 409)
        changed = self.call(
            "update_slide",
            {"presentation_id": pid, "slide": 1, "ui": {"id": "custom", "components": [{"id": "box", "elements": []}]}, "speaker_note": "New notes"},
        )
        self.assertEqual(changed.status_code, 200, changed.text)
        source = self.call("get_slide", {"presentation_id": pid, "slide": 1}).json()
        self.assertEqual(source["ui"]["id"], "custom")
        self.assertEqual(source["speaker_note"], "New notes")
        edited = self.call("edit_presentation", {"presentation_id": pid, "prompt": "Add a styled component"})
        self.assertEqual(edited.status_code, 200, edited.text)
        edited = self.finish_edit(pid)
        self.assertTrue(edited.json()["changed"])
        self.assertEqual(edited.json()["actions"], ["addComponent"])

    def test_batch_edits_only_export_at_the_end(self):
        pid = self.create()
        self.call("get_presentation_async_job", {"presentation_id": pid})
        before = len(self.calls)
        for _ in range(2):
            result = self.call("manage_slides", {"presentation_id": pid, "action": "duplicate", "slide": 1, "defer_export": True})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertTrue(result.json()["needs_export"])
            self.assertNotIn("artifact", result.json())
        self.assertFalse(any(path.endswith("/export") for path, _ in self.calls[before:]))
        result = self.call("export_presentation", {"presentation_id": pid, "format": "pptx"})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(result.json()["artifact"]["downloadUrl"])
        self.assertEqual([data["export_as"] for path, data in self.calls[before:] if path.endswith("/export")], ["pptx", "pdf"])

    def test_invalid_structural_and_image_changes_do_not_mutate(self):
        pid = self.create()
        self.call("get_presentation_async_job", {"presentation_id": pid})
        for fields in ({"action": "reorder", "order": [1, 1]}, {"action": "delete", "slide": 1}, {"action": "duplicate"}, {"action": "add", "position": 8}):
            self.assertEqual(self.call("manage_slides", {"presentation_id": pid, **fields}).status_code, 422)
        before = len(self.calls)
        for url in ("file:///etc/passwd", "https://127.0.0.1/private", "/app_data/templates/../../fastapi.db", "/app_data/uploads/foreign.png"):
            r = self.call("update_slide", {"presentation_id": pid, "slide": 1, "ui": {"components": [{"elements": [{"type": "image", "data": url}]}]}})
            self.assertEqual(r.status_code, 422, r.text)
        self.assertFalse(any(p.endswith(("/slide_update", "/presentation/update")) for p, _ in self.calls[before:]))

    def test_export_paths_cannot_escape_trusted_service(self):
        pid = self.create()
        row = presentations.owned(pid, "alice")
        for path in (
            "https://evil.test/app_data/exports/x.pptx",
            "/app_data/exports/../secrets.pptx",
            "/app_data/exports/%2e%2e/secrets.pptx",
            "/app_data/uploads/secret.pptx",
            "//evil.test/x.pptx",
        ):
            before = len(self.calls)
            with self.assertRaises(main.HTTPException):
                presentations.store_export(row, {"path": path}, "pptx")
            self.assertEqual(len(self.calls), before)
        self.assertIsNone(presentations.NoRedirect().redirect_request(None, None, 302, "redirect", {}, "http://evil.test"))


if __name__ == "__main__":
    unittest.main()
