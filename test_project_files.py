"""Saving chat source files, project ownership, offline reuse and citation checks."""
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import py7zr
import pymupdf
from fastapi.testclient import TestClient

import api
import datasets
import digimv
import documents
import project_files
import projects


class SavedFilesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.data = patch.object(digimv, "DATA", self.root)
        self.pub = patch.object(documents, "PUB", self.root / "pub")
        self.data.start(); self.pub.start()
        self.client = TestClient(api.app)
        self.alice = {"cf-access-authenticated-user-email": "alice@example.test"}
        self.bob = {"cf-access-authenticated-user-email": "bob@example.test"}
        self.pid = self.call("POST", "/projects", json={"name": "Research"}).json()["id"]
        self.tid = "a" * 20
        tables = documents.PUB / "tables"
        tables.mkdir(parents=True)
        self.table_path = tables / self.tid
        self.body = b"AGB;Waarde\n0011;7\n0011;12\n0022;20\n"
        self.table_path.write_bytes(self.body)
        self.table_path.with_suffix(".json").write_text(json.dumps({
            "file_url": "https://example.test/services/file/get?key=expired", "content_type": "text/csv",
            "fetched_at": "2026-11-13T10:00:00+00:00"}))

    def tearDown(self):
        self.client.close(); self.pub.stop(); self.data.stop(); self.tmp.cleanup()

    def call(self, method, path, **kw):
        return self.client.request(method, path, headers=kw.pop("headers", self.alice), **kw)

    def save(self, href=None, **kw):
        return self.call("POST", f"/projects/{self.pid}/saved-files", json={"href": href or f"/bron/rij/{self.tid}/2"}, **kw)

    def test_save_reuse_download_and_private_citations(self):
        result = self.save()
        self.assertEqual(result.status_code, 201, result.text)
        did = result.json()["id"]
        base = f"/projects/{self.pid}/documents/{did}"
        self.table_path.unlink()  # saving preserves the file after public-cache eviction / an expired URL
        self.assertEqual(self.call("GET", base + "/file").content, self.body)
        self.assertEqual(self.call("GET", base + "/table?for_model=true").status_code, 403)
        self.call("PUT", f"/projects/{self.pid}", json={"name": "Research", "allow_private": True})
        r = self.call("GET", base + "/table", params={"for_model": "true", "filters": '{"AGB":["0011"]}', "sort": "-Waarde"})
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertEqual([x["Waarde"] for x in data["rows"]], ["12", "7"])
        self.assertEqual(data["row_cite"], f"/bron/project/{self.pid}/{did}/rij/")
        self.assertEqual(self.call("GET", base + "/rows/3").json()["row"], data["rows"][0])
        self.assertEqual(self.call("GET", base + "/rows/99").status_code, 404)
        self.assertEqual(self.call("GET", base + "/table?filters=[]").status_code, 400)
        self.call("PUT", f"/projects/{self.pid}", json={"name": "Research", "allow_private": False})
        self.assertEqual(self.call("GET", base + "/table?for_model=true").status_code, 403)

    def test_archives_read_the_saved_member_and_reopen_rows(self):
        buf = io.BytesIO()
        with py7zr.SevenZipFile(buf, "w") as z:
            z.writestr(self.body, "data/kwaliteit.csv")
            z.writestr('[{"x": 2}]', "other.json")
        self.table_path.write_bytes(buf.getvalue())
        did = self.save().json()["id"]
        base = f"/projects/{self.pid}/documents/{did}"
        self.assertEqual(self.call("GET", base + "/table").status_code, 400)
        data = self.call("GET", base + "/table", params={"member": "data/kwaliteit.csv"}).json()
        self.assertEqual(data["row_cite"], f"/bron/project/{self.pid}/{did}/rij/data%2Fkwaliteit.csv/")
        self.assertEqual(self.call("GET", base + "/rows/2?part=data%2Fkwaliteit.csv").json()["row"]["AGB"], "0011")
        self.assertIn(".7z", self.call("GET", base + "/file").headers["content-disposition"])

    def test_ownership_and_input_boundaries(self):
        self.assertEqual(self.save(headers={}).status_code, 401)
        self.assertEqual(self.save(headers=self.bob).status_code, 404)
        self.assertEqual(self.save(headers={**self.alice, "origin": "https://evil.test"}).status_code, 403)
        for href in ("https://example.test/file.pdf", "/etc/passwd", "/bron/rij/../../etc/passwd/1", f"/bron/project/{self.pid}/{'b'*32}/1"):
            self.assertEqual(self.save(href).status_code, 400, href)
        did = self.save().json()["id"]
        base = f"/projects/{self.pid}/documents/{did}"
        for suffix in ("/file", "/table", "/rows/2"):
            response = self.call("GET", base + suffix, headers=self.bob)
            self.assertEqual(response.status_code, 404)
            self.assertIn("no-store", response.headers["cache-control"])
        other = self.call("POST", "/projects", json={"name": "Other"}).json()["id"]
        self.assertEqual(self.call("GET", f"/projects/{other}/documents/{did}/table").status_code, 404)

    def test_duplicate_restore_and_delete(self):
        first = self.save().json()
        did = first["id"]
        self.assertFalse(first["existing"])
        second = self.save(f"/bron/rij/{self.tid}/3").json()
        self.assertEqual(second, {"id": did, "existing": True})
        self.call("PUT", f"/projects/{self.pid}", json={"name": "Research", "allow_private": True})
        self.call("POST", f"/projects/{self.pid}/documents/{did}/archive")
        self.assertEqual(self.call("GET", f"/projects/{self.pid}/documents/{did}/table?for_model=true").status_code, 404)
        self.save()
        docs = self.call("GET", f"/projects/{self.pid}/documents").json()
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0]["archived"], 0)
        self.call("DELETE", f"/projects/{self.pid}/documents/{did}")
        self.assertFalse(projects.path_for(did).exists())
        with project_files.database() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM project_saved_files").fetchone()[0], 0)
        did = self.save().json()["id"]
        self.call("DELETE", f"/projects/{self.pid}")
        self.assertFalse(projects.path_for(did).exists())

    def test_size_limit_and_failed_copy_leave_no_document(self):
        with patch.object(projects, "MAX_FILE", 1):
            self.assertEqual(self.save().status_code, 413)
        with patch.object(project_files.shutil, "copyfile", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.save()
        self.assertEqual(self.call("GET", f"/projects/{self.pid}/documents").json(), [])
        self.assertFalse(list((self.root / "private").glob("*")))

    def test_pdf_uses_existing_processing_and_consent(self):
        path = documents.PUB / "report.pdf"
        with pymupdf.open() as pdf:
            pdf.new_page().insert_text((72, 72), "Saved research evidence 125000")
            pdf.save(path)
        with patch.object(documents, "document_meta", return_value={"title": "Report", "file_url": "https://example.test/report.pdf", "fetched_at": "2026-11-13"}), \
                patch.object(documents, "document_pdf", return_value=path):
            r = self.save(f"/bron/doc/{'b'*20}/1")
        self.assertEqual(r.status_code, 201, r.text)
        did = r.json()["id"]
        path.unlink()
        projects.process_document(did)
        page = self.call("GET", f"/projects/{self.pid}/documents/{did}/pages/1").json()
        self.assertIn("125000", page["text"])
        self.assertEqual(page["href"], f"/bron/project/{self.pid}/{did}/1")


if __name__ == "__main__":
    unittest.main()
