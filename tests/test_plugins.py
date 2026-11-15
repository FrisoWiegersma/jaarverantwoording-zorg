"""Offline MCP plugin store, SSRF boundary, credential masking and JSON-RPC tool tests."""

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "api"))

import digimv
import main
import presentations
from fastapi.testclient import TestClient


class _FakeMcpResponse:
    def __init__(self, body: bytes, content_type: str = "application/json", session_id: str = "sess-1"):
        self._buf = io.BytesIO(body)
        self.headers = {"Content-Type": content_type, "Mcp-Session-Id": session_id}

    def read(self, n: int = -1) -> bytes:
        return self._buf.read(n)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class PluginsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = patch.object(digimv, "DATA", Path(self.tmp.name))
        self.data.start()
        self.no_presenton = patch.object(presentations, "configured", return_value=False)
        self.no_presenton.start()
        self.client = TestClient(main.app)
        self.alice = {"cf-access-authenticated-user-email": "alice@example.test"}
        self.bob = {"cf-access-authenticated-user-email": "bob@example.test"}

    def tearDown(self):
        self.client.close()
        self.no_presenton.stop()
        self.data.stop()
        self.tmp.cleanup()

    def call(self, method: str, path: str, **kwargs):
        return self.client.request(method, path, headers=kwargs.pop("headers", self.alice), **kwargs)

    def test_presets_auth_and_ssrf_boundary(self):
        presets = self.call("GET", "/plugins/presets").json()
        self.assertTrue(any(p["handle"] == "canva" for p in presets))

        self.assertEqual(self.call("GET", "/plugins", headers={}).status_code, 401)
        self.assertEqual(
            self.call(
                "POST",
                "/plugins",
                headers={**self.alice, "origin": "https://evil.test"},
                json={"handle": "canva", "name": "Canva", "url": "https://mcp.canva.com/mcp", "sync": False},
            ).status_code,
            403,
        )
        # Loopback and private addresses must be blocked against SSRF.
        for bad_url in ("http://127.0.0.1:8000/mcp", "http://localhost:8000/mcp", "file:///etc/passwd"):
            res = self.call(
                "POST",
                "/plugins",
                json={"handle": "local", "name": "Local", "url": bad_url, "sync": False},
            )
            self.assertEqual(res.status_code, 400, bad_url)

    def test_crud_token_masking_and_mcp_sync_and_call(self):
        requests_seen: list[dict] = []

        def fake_open(req, timeout=45):
            payload = json.loads(req.data.decode("utf-8"))
            headers = {k.lower(): v for k, v in req.header_items()}
            requests_seen.append({"url": req.full_url, "payload": payload, "headers": headers})
            method = payload.get("method")
            if method == "initialize":
                body = json.dumps({"jsonrpc": "2.0", "id": payload["id"], "result": {"protocolVersion": "2025-03-26"}}).encode()
                return _FakeMcpResponse(body)
            if method == "notifications/initialized":
                return _FakeMcpResponse(b"{}")
            if method == "tools/list":
                body = (
                    "event: message\ndata: "
                    + json.dumps(
                        {
                            "jsonrpc": "2.0",
                            "id": payload["id"],
                            "result": {
                                "tools": [
                                    {
                                        "name": "create_presentation",
                                        "description": "Maak een Canva-presentatie op basis van dia-inhoud.",
                                        "inputSchema": {
                                            "type": "object",
                                            "properties": {
                                                "title": {"type": "string"},
                                                "slides": {"type": "array"},
                                                "operation": {
                                                    "anyOf": [
                                                        {"type": "object", "properties": {"type": {"type": "string", "const": "update_title"}}},
                                                        {"type": "object", "properties": {"type": {"type": "string", "const": "replace_text"}}},
                                                    ]
                                                },
                                            },
                                            "required": ["title"],
                                        },
                                    }
                                ]
                            },
                        }
                    )
                    + "\n\n"
                ).encode()
                return _FakeMcpResponse(body, content_type="text/event-stream")
            if method == "tools/call":
                args = payload["params"]["arguments"]
                body = json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": payload["id"],
                        "result": {
                            "content": [
                                {"type": "text", "text": f"Presentatie aangemaakt: {args.get('title')}"},
                                {"type": "resource_link", "name": "Open in Canva", "uri": "https://www.canva.com/design/DAG123/view"},
                            ]
                        },
                    }
                ).encode()
                return _FakeMcpResponse(body)
            raise AssertionError(f"Unexpected MCP method: {method}")

        with (
            patch("documents._check", return_value=None),
            patch("urllib.request.OpenerDirector.open", side_effect=fake_open),
        ):
            created = self.call(
                "POST",
                "/plugins",
                json={
                    "handle": "@Canva",
                    "name": "Canva",
                    "description": "Slide decks maken",
                    "url": "https://mcp.canva.com/mcp",
                    "transport": "streamable_http",
                    "token": "secret-canva-token",
                    "headers": {"X-Workspace": "zorg"},
                },
            )
            self.assertEqual(created.status_code, 201, created.text)
            plugin = created.json()
            pid = plugin["id"]
            self.assertEqual(plugin["handle"], "canva")
            self.assertTrue(plugin["has_token"])
            self.assertNotIn("token", plugin)
            self.assertNotIn("secret-canva-token", created.text)
            self.assertEqual(plugin["header_keys"], ["X-Workspace"])
            self.assertEqual(len(plugin["tools"]), 1)
            self.assertEqual(plugin["tools"][0]["name"], "create_presentation")
            op_anyof = plugin["tools"][0]["inputSchema"]["properties"]["operation"]["anyOf"]
            self.assertEqual(op_anyof[0]["properties"]["type"]["enum"], ["update_title"])
            self.assertEqual(op_anyof[1]["properties"]["type"]["enum"], ["replace_text"])

            # Owner isolation: Bob cannot see or call Alice's plugin.
            self.assertEqual(self.call("GET", "/plugins", headers=self.bob).json(), [])
            self.assertEqual(
                self.call("POST", f"/plugins/{pid}/call", headers=self.bob, json={"tool": "create_presentation", "arguments": {}}).status_code,
                404,
            )

            # Updating without sending a new token preserves the stored token.
            updated = self.call(
                "PUT",
                f"/plugins/{pid}",
                json={
                    "handle": "canva",
                    "name": "Canva Presentaties",
                    "description": "Slide decks maken",
                    "url": "https://mcp.canva.com/mcp",
                    "transport": "streamable_http",
                    "sync": True,
                },
            ).json()
            self.assertTrue(updated["has_token"])
            self.assertEqual(updated["name"], "Canva Presentaties")

            # Calling the MCP tool sends the Bearer token and returns normalized text + links.
            called = self.call(
                "POST",
                f"/plugins/{pid}/call",
                json={"tool": "create_presentation", "arguments": {"title": "Kerncijfers Alrijne 2024"}},
            )
            self.assertEqual(called.status_code, 200, called.text)
            out = called.json()
            self.assertIn("Kerncijfers Alrijne 2024", out["text"])
            self.assertIn("https://www.canva.com/design/DAG123/view", out["text"])
            self.assertEqual(requests_seen[-1]["headers"].get("authorization"), "Bearer secret-canva-token")
            self.assertEqual(requests_seen[-1]["headers"].get("x-workspace"), "zorg")
            self.assertEqual(requests_seen[-1]["headers"].get("mcp-session-id"), "sess-1")

            # Deleting removes the plugin.
            self.assertEqual(self.call("DELETE", f"/plugins/{pid}").status_code, 200)
            self.assertEqual(self.call("GET", "/plugins").json(), [])

            # Setting CANVA_MCP_TOKEN in .env automatically provisions @canva with has_token=True.
            with patch.dict("os.environ", {"CANVA_MCP_TOKEN": "env-canva-secret"}):
                auto_list = self.call("GET", "/plugins").json()
                self.assertEqual(len(auto_list), 1)
                self.assertEqual(auto_list[0]["handle"], "canva")
                self.assertTrue(auto_list[0]["has_token"])
                self.assertNotIn("env-canva-secret", json.dumps(auto_list))

    def test_mcp_oauth_pkce_and_dynamic_client_registration(self):
        import urllib.error
        import urllib.parse

        token_seen = {"token": ""}

        def fake_open(req, timeout=45):
            url = req.full_url
            headers = {k.lower(): v for k, v in req.header_items()}
            if url == "https://mcp.canva.com/.well-known/oauth-protected-resource":
                return _FakeMcpResponse(json.dumps({"authorization_servers": ["https://mcp.canva.com"]}).encode())
            if url == "https://mcp.canva.com/.well-known/oauth-authorization-server":
                return _FakeMcpResponse(
                    json.dumps(
                        {
                            "authorization_endpoint": "https://www.canva.com/api/oauth/authorize",
                            "token_endpoint": "https://api.canva.com/rest/v1/oauth/token",
                            "registration_endpoint": "https://mcp.canva.com/register",
                            "scopes_supported": ["design:content:read", "design:content:write"],
                        }
                    ).encode()
                )
            if url == "https://mcp.canva.com/register":
                return _FakeMcpResponse(json.dumps({"client_id": "dyn-canva-client", "client_secret": "dyn-secret"}).encode())
            if url == "https://api.canva.com/rest/v1/oauth/token":
                body = urllib.parse.parse_qs(req.data.decode("utf-8"))
                self.assertEqual(body["grant_type"], ["authorization_code"])
                self.assertEqual(body["code"], ["auth-code-123"])
                self.assertEqual(body["client_id"], ["dyn-canva-client"])
                self.assertTrue(body.get("code_verifier"))
                return _FakeMcpResponse(json.dumps({"access_token": "oauth-canva-access-token"}).encode())
            if url == "https://mcp.canva.com/mcp":
                auth = headers.get("authorization", "")
                if not auth:
                    raise urllib.error.HTTPError(url, 401, "Unauthorized", {}, None)
                token_seen["token"] = auth
                payload = json.loads(req.data.decode("utf-8"))
                method = payload.get("method")
                if method == "initialize":
                    return _FakeMcpResponse(json.dumps({"jsonrpc": "2.0", "id": payload["id"], "result": {}}).encode())
                if method == "notifications/initialized":
                    return _FakeMcpResponse(b"{}")
                if method == "tools/list":
                    return _FakeMcpResponse(
                        json.dumps(
                            {
                                "jsonrpc": "2.0",
                                "id": payload["id"],
                                "result": {"tools": [{"name": "create_deck", "description": "Create deck", "inputSchema": {"type": "object"}}]},
                            }
                        ).encode()
                    )
            raise AssertionError(f"Unexpected URL: {url}")

        with (
            patch("documents._check", return_value=None),
            patch("urllib.request.OpenerDirector.open", side_effect=fake_open),
        ):
            # 1. Creating Canva without a token receives 401 from MCP and sets needs_oauth=True.
            created = self.call(
                "POST",
                "/plugins",
                json={"handle": "canva", "name": "Canva", "url": "https://mcp.canva.com/mcp", "sync": True},
            ).json()
            self.assertTrue(created.get("needs_oauth"))
            self.assertFalse(created["has_token"])
            pid = created["id"]

            # 2. Starting OAuth discovers RFC 8414 metadata, registers dynamic client, and 302 redirects with PKCE.
            start = self.call("GET", f"/plugins/{pid}/oauth/start", follow_redirects=False)
            self.assertEqual(start.status_code, 302)
            location = start.headers["location"]
            self.assertTrue(location.startswith("https://www.canva.com/api/oauth/authorize?"))
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(location).query)
            self.assertEqual(qs["client_id"], ["dyn-canva-client"])
            self.assertEqual(qs["code_challenge_method"], ["S256"])
            state = qs["state"][0]

            # 3. Completing OAuth callback rejects another user, then exchanges code + PKCE verifier for the owner.
            wrong_user = self.call("GET", f"/plugins/oauth/callback?code=auth-code-123&state={state}", headers=self.bob)
            self.assertNotIn("mcp-oauth-complete", wrong_user.text)
            cb = self.call("GET", f"/plugins/oauth/callback?code=auth-code-123&state={state}")
            self.assertEqual(cb.status_code, 200)
            self.assertIn("mcp-oauth-complete", cb.text)
            self.assertEqual(token_seen["token"], "Bearer oauth-canva-access-token")

            # 4. Plugin now has token=True (masked) and discovered tools cached.
            plugins_list = self.call("GET", "/plugins").json()
            self.assertEqual(len(plugins_list), 1)
            self.assertTrue(plugins_list[0]["has_token"])
            self.assertEqual(plugins_list[0]["tools"][0]["name"], "create_deck")

    def test_mcp_registry_search_combines_verified_and_live_registry(self):
        def fake_open(req, timeout=45):
            self.assertIn("registry.modelcontextprotocol.io/v0/servers", req.full_url)
            self.assertIn("search=miro", req.full_url)
            body = json.dumps(
                {
                    "servers": [
                        {
                            "server": {
                                "name": "com.miro/miro-mcp-server",
                                "title": "Miro",
                                "description": "Whiteboards en diagrammen genereren in Miro.",
                                "remotes": [{"type": "streamable-http", "url": "https://mcp.miro.com/mcp"}],
                            }
                        },
                        {
                            # Local-only server without remotes must be filtered out
                            "server": {"name": "io.local/stdio-only", "description": "Local stdio"}
                        },
                    ]
                }
            ).encode()
            return _FakeMcpResponse(body)

        with (
            patch("documents._check", return_value=None),
            patch("urllib.request.OpenerDirector.open", side_effect=fake_open),
        ):
            res = self.call("GET", "/plugins/registry?q=miro").json()
            self.assertEqual(len(res), 1)
            self.assertEqual(res[0]["handle"], "miro")
            self.assertEqual(res[0]["name"], "Miro")
            self.assertEqual(res[0]["url"], "https://mcp.miro.com/mcp")
            self.assertEqual(res[0]["transport"], "streamable_http")
            self.assertEqual(res[0]["source"], "registry")


if __name__ == "__main__":
    unittest.main()
