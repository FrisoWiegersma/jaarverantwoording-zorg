"""Offline project workflow and private-data boundary checks. No Gemini or DigiMV calls."""
import io
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import digimv
import main
import projects
import pymupdf
from fastapi.testclient import TestClient


class ProjectsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = patch.object(digimv, "DATA", Path(self.tmp.name))
        self.data.start()
        self.client = TestClient(main.app)  # no lifespan: tests explicitly run processing jobs
        self.alice = {"cf-access-authenticated-user-email": "alice@example.test"}
        self.bob = {"cf-access-authenticated-user-email": "bob@example.test"}
        self.pid = self.call("POST", "/projects", json={"name": "Financiële review", "client": "Testklant"}).json()["id"]

    def tearDown(self):
        self.client.close()
        self.data.stop()
        self.tmp.cleanup()

    def call(self, method, path, **kwargs):
        return self.client.request(method, path, headers=kwargs.pop("headers", self.alice), **kwargs)

    def note(self, text="Personeelskosten stijgen met 10 procent."):
        return self.call("POST", f"/projects/{self.pid}/notes", json={"title": "Interview", "text": text}).json()["id"]

    def pdf(self, scanned=False):
        pdf = pymupdf.open()
        page = pdf.new_page()
        page.insert_text((72, 72), "Eigen vermogen 108.256")
        if scanned:
            image = page.get_pixmap().tobytes("png")
            pdf.close()
            pdf = pymupdf.open()
            page = pdf.new_page()
            page.insert_image(page.rect, stream=image)
        data = pdf.tobytes()
        pdf.close()
        return data

    def upload(self, data=None):
        return self.call("POST", f"/projects/{self.pid}/documents", files={"file": ("rapport.pdf", data or self.pdf(), "application/pdf")})

    def test_auth_and_origin(self):
        did = self.note()
        for path in ("/projects", f"/projects/{self.pid}", f"/projects/{self.pid}/documents/{did}/pages/1"):
            self.assertEqual(self.call("GET", path, headers={}).status_code, 401)
        for suffix in ("", "/documents", "/search?q=personeel", f"/documents/{did}/pages/1", f"/documents/{did}/pdf", f"/documents/{did}/pages/1.png"):
            response = self.call("GET", f"/projects/{self.pid}{suffix}", headers=self.bob)
            self.assertEqual(response.status_code, 404, suffix)
            self.assertIn("no-store", response.headers["cache-control"])
        self.assertEqual(self.call("POST", "/projects", headers={**self.alice, "origin": "https://evil.test"}, json={"name": "bad"}).status_code, 403)
        other = self.call("POST", "/projects", json={"name": "Other"}).json()["id"]
        self.assertEqual(self.call("GET", f"/projects/{other}/documents/{did}/pages/1").status_code, 404)

    def test_context_sources_and_example(self):
        did = self.note()
        page_url = f"/projects/{self.pid}/documents/{did}/pages/1"
        first = self.call("GET", page_url).json()
        self.assertEqual(first["href"], f"/bron/project/{self.pid}/{did}/1")
        replacement = self.note("Nieuwe bronversie")
        self.assertNotEqual(did, replacement)
        self.call("POST", f"/projects/{self.pid}/documents/{did}/archive")
        self.assertEqual(self.call("GET", f"/projects/{self.pid}/search?q=Personeelskosten").json(), [])
        self.assertEqual(self.call("GET", page_url).json()["text"], first["text"])
        self.assertEqual(self.call("GET", f"/projects/{self.pid}/documents?for_model=true").status_code, 403)
        example = self.call("POST", "/projects/example")
        self.assertEqual(example.status_code, 201, example.text)
        eid = example.json()["id"]
        docs = self.call("GET", f"/projects/{eid}/documents").json()
        self.assertEqual(len(docs), 2)
        chats = self.call("GET", f"/chats?project_id={eid}").json()
        answer = self.call("GET", f"/chats/{chats[0]['id']}").json()["messages"][-1]["parts"][0]["text"]
        self.assertIn(f"/bron/project/{eid}/", answer)
        self.assertIn("fictieve", answer)
        self.assertNotIn("client", example.json())
        self.assertEqual(self.call("GET", f"/projects/{eid}", headers=self.bob).status_code, 404)

    def test_upload_processing_and_consent(self):
        self.assertEqual(self.upload(b"not a PDF").status_code, 400)
        pdf = pymupdf.open(stream=self.pdf(), filetype="pdf")
        encrypted = pdf.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="secret", user_pw="secret")
        pdf.close()
        self.assertEqual(self.upload(encrypted).status_code, 400)
        did = self.upload().json()["id"]
        with patch.object(digimv, "_gemini", side_effect=AssertionError("No private OCR without consent")):
            projects.process_document(did)
        page = self.call("GET", f"/projects/{self.pid}/documents/{did}/pages/1").json()
        self.assertIn("108.256", page["text"])
        self.assertEqual(len(self.call("GET", f"/projects/{self.pid}/search?q=eigen vermogen").json()), 1)
        self.assertEqual(self.call("GET", f"/projects/{self.pid}/documents/{did}/pages/1?for_model=true").status_code, 403)
        self.assertEqual(self.call("GET", f"/projects/{self.pid}/search?q=eigen&for_model=true").status_code, 403)
        self.assertEqual(self.call("GET", f"/projects/{self.pid}/documents/{did}/pages/2").status_code, 404)
        self.assertEqual(self.call("GET", f"/projects/{self.pid}/documents/{did}/pages/1.png?quote=108.256").headers["x-found"], "all")
        scan = self.upload(self.pdf(scanned=True)).json()["id"]
        with patch.object(digimv, "_gemini", side_effect=AssertionError("No consent")):
            projects.process_document(scan)
        self.assertEqual(self.call("GET", f"/projects/{self.pid}/documents/{scan}/pages/1").json()["source"], "needs_ocr")
        p = self.call("GET", f"/projects/{self.pid}").json()
        self.call("PUT", f"/projects/{self.pid}", json={**p, "allow_private": True})
        with patch.object(digimv, "_gemini", return_value=("Eigen vermogen 108.256", "test-ocr")) as ocr:
            projects.process_document(scan)
            self.assertEqual(ocr.call_count, 1)
        self.assertEqual(self.call("GET", f"/projects/{self.pid}/model-context").status_code, 200)
        self.call("PUT", f"/projects/{self.pid}", json={**p, "allow_private": False})
        self.assertEqual(self.call("GET", f"/projects/{self.pid}/model-context").status_code, 403)

    def test_existing_chat_database_migrates_without_losing_history(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as folder, patch.object(digimv, "DATA", Path(folder)):
            with sqlite3.connect(Path(folder) / "chats.db") as db:
                db.execute("CREATE TABLE chats(user TEXT,id TEXT,title TEXT,updated TEXT,messages TEXT,PRIMARY KEY(user,id))")
                db.execute("INSERT INTO chats VALUES (?,?,?,?,?)", ("alice@example.test", "legacy-id", "Oud gesprek", "2026-01-01", json.dumps([{"id":"first-message", "role":"user", "parts":[]}])) )
            result = self.call("GET", "/chats/legacy-id")
            self.assertEqual(result.status_code, 200)
            self.assertIsNone(result.json()["project_id"])
            self.assertEqual(result.json()["messages"][0]["id"], "first-message")
            body = {"title": "Bijgewerkt", "messages": result.json()["messages"]}
            self.assertEqual(self.call("PUT", "/chats/legacy-id", json=body).status_code, 200)
            self.assertEqual(self.call("GET", "/chats").json()[0]["id"], "legacy-id")

    def test_markdown_knowledge_upload(self):
        text = "# Sectorcontext\nPersoneelskosten zijn geen bewijs voor kwaliteit van zorg.\n<script>untrusted()</script>"
        response = self.call("POST", f"/projects/{self.pid}/documents", files={"file": ("context.md", text.encode(), "text/markdown")})
        self.assertEqual(response.status_code, 201, response.text)
        did = response.json()["id"]
        page = self.call("GET", f"/projects/{self.pid}/documents/{did}/pages/1").json()
        self.assertEqual(page["text"], text)
        self.assertEqual(page["kind"], "markdown")
        self.assertEqual(page["source"], "markdown")
        original = self.call("GET", f"/projects/{self.pid}/documents/{did}/original")
        self.assertEqual(original.text, text)
        self.assertIn("attachment", original.headers["content-disposition"])
        self.assertEqual(self.call("GET", f"/projects/{self.pid}/documents/{did}/original", headers=self.bob).status_code, 404)
        self.assertEqual(len(self.call("GET", f"/projects/{self.pid}/search?q=kwaliteit").json()), 1)
        self.assertEqual(self.call("GET", f"/projects/{self.pid}/documents/{did}/pages/1?for_model=true").status_code, 403)
        bad = self.call("POST", f"/projects/{self.pid}/documents", files={"file": ("bad.md", b"\xff\x00", "text/markdown")})
        self.assertEqual(bad.status_code, 400)

    def test_revocation_blocks_ocr_retry(self):
        import urllib.error
        p = self.call("GET", f"/projects/{self.pid}").json()
        self.call("PUT", f"/projects/{self.pid}", json={**p, "allow_private": True})
        def revoke(_):
            self.call("PUT", f"/projects/{self.pid}", json={**p, "allow_private": False})
        error = urllib.error.HTTPError("https://example.test", 429, "retry", {}, io.BytesIO(b"retry"))
        with patch.dict("os.environ", {"GEMINI_API_KEY": "synthetic-test-key"}), \
             patch.object(digimv, "_http", side_effect=error) as http, \
             patch.object(digimv.time, "sleep", side_effect=revoke):
            with self.assertRaises(PermissionError):
                digimv._gemini(b"synthetic", before_request=lambda: projects.require_consent(self.pid))
            self.assertEqual(http.call_count, 1)

    def test_chats_migration_scope_and_restart(self):
        body = {"title": "Onderzoek", "messages": [{"role": "user", "parts": []}], "project_id": self.pid}
        self.assertEqual(self.call("PUT", "/chats/chat1", json=body).status_code, 200)
        self.assertEqual(self.call("GET", "/chats").json(), [])
        self.assertEqual(len(self.call("GET", f"/chats?project_id={self.pid}").json()), 1)
        self.assertEqual(self.call("GET", "/chats/chat1", headers=self.bob).status_code, 404)
        self.assertEqual(self.call("PUT", "/chats/chat1", json={**body, "project_id": None}).status_code, 409)
        did = self.upload().json()["id"]
        with projects.database() as db:
            db.execute("UPDATE project_documents SET status='processing' WHERE id=?", (did,))
        stop = threading.Event()
        stop.set()
        projects.worker(stop)
        self.assertEqual(self.call("GET", f"/projects/{self.pid}/documents").json()[0]["status"], "queued")

    def test_delete_project_and_document_lifecycle(self):
        did_pdf = self.upload().json()["id"]
        did_note = self.note("Notitie om te archiveren en verwijderen")
        self.assertEqual(self.call("PUT", "/chats/c-del", json={"title": "T", "messages": [{"role": "user", "parts": []}], "project_id": self.pid}).status_code, 200)

        listed = self.call("GET", "/projects").json()
        self.assertEqual(listed[0]["doc_count"], 2)
        self.assertEqual(listed[0]["chat_count"], 1)

        self.assertEqual(self.call("POST", f"/projects/{self.pid}/documents/{did_note}/archive").status_code, 200)
        self.assertEqual(self.call("GET", "/projects").json()[0]["doc_count"], 1)
        self.assertEqual(self.call("POST", f"/projects/{self.pid}/documents/{did_note}/unarchive").status_code, 200)
        self.assertEqual(self.call("GET", "/projects").json()[0]["doc_count"], 2)

        self.assertEqual(self.call("DELETE", f"/projects/{self.pid}/documents/{did_note}").status_code, 200)
        self.assertEqual(len(self.call("GET", f"/projects/{self.pid}/documents").json()), 1)

        self.assertEqual(self.call("DELETE", f"/projects/{self.pid}", headers=self.bob).status_code, 404)

        pdf_path = projects.path_for(did_pdf)
        self.assertTrue(pdf_path.exists())
        self.assertEqual(self.call("DELETE", f"/projects/{self.pid}").status_code, 200)
        self.assertFalse(pdf_path.exists())
        self.assertEqual(self.call("GET", f"/projects/{self.pid}").status_code, 404)
        self.assertEqual(self.call("GET", "/chats/c-del").status_code, 404)
        self.assertEqual(self.call("GET", "/projects").json(), [])


if __name__ == "__main__":
    unittest.main()
