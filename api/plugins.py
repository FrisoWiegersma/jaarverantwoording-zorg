"""Owner-scoped MCP plugins (@canva, @notion, @linear, or custom remote MCP servers) with MCP OAuth 2.1 + PKCE."""

import base64
import hashlib
import html
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from contextlib import contextmanager

import documents
import presentations
import projects
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field, ValidationError

router = APIRouter(prefix="/plugins")

HANDLE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,30}$")
HEADER_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
FORBIDDEN_HEADERS = {"host", "content-length", "transfer-encoding", "connection", "cf-access-authenticated-user-email"}
TRANSPORTS = {"auto", "streamable_http", "sse"}
MCP_TIMEOUT = 45
OAUTH_TTL = 600
# These logins reject any redirect URI that is not on loopback (checked 2026-11: Canva at authorize, Asana and
# Intercom at client registration).
LOOPBACK_REDIRECT_HOSTS = {"mcp.canva.com", "mcp.asana.com", "mcp.intercom.com"}
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}

# In-memory pending PKCE OAuth flows: state -> {pid, owner, code_verifier, token_endpoint, client_id, client_secret, redirect_uri, expires}
_PENDING_OAUTH: dict[str, dict] = {}

PRESETS = [
    {
        "id": "canva",
        "handle": "canva",
        "name": "Canva",
        "description": "Presentaties, slide decks en infographics maken vanuit cijfers en projectdocumenten.",
        "url": "https://mcp.canva.com/mcp",
        "transport": "streamable_http",
    },
    {
        "id": "notion",
        "handle": "notion",
        "name": "Notion",
        "description": "Pagina’s en databases in Notion doorzoeken of aanmaken vanuit je onderzoek.",
        "url": "https://mcp.notion.com/mcp",
        "transport": "streamable_http",
    },
    {
        "id": "linear",
        "handle": "linear",
        "name": "Linear",
        "description": "Actiepunten, projecten en vervolgstappen vastleggen als issues.",
        "url": "https://mcp.linear.app/mcp",
        "transport": "streamable_http",
    },
    {
        "id": "figma",
        "handle": "figma",
        "name": "Figma",
        "description": "Designs, frames en componenten uit Figma ophalen of inspecteren.",
        "url": "https://mcp.figma.com/mcp",
        "transport": "streamable_http",
    },
    {
        "id": "github",
        "handle": "github",
        "name": "GitHub",
        "description": "Repositories, issues, pull requests en documentatie doorzoeken.",
        "url": "https://api.githubcopilot.com/mcp/",
        "transport": "streamable_http",
    },
    {
        "id": "atlassian",
        "handle": "atlassian",
        "name": "Atlassian (Jira & Confluence)",
        "description": "Confluence-kennisbanken en Jira-projecten doorzoeken of bijwerken.",
        "url": "https://mcp.atlassian.com/v1/sse",
        "transport": "sse",
    },
    {
        "id": "asana",
        "handle": "asana",
        "name": "Asana",
        "description": "Taken, mijlpalen en projectplanning beheren in Asana.",
        "url": "https://mcp.asana.com/sse",
        "transport": "sse",
    },
    {
        "id": "sentry",
        "handle": "sentry",
        "name": "Sentry",
        "description": "Foutmeldingen, releases en systeemstatus analyseren.",
        "url": "https://mcp.sentry.dev/mcp",
        "transport": "streamable_http",
    },
    {
        "id": "stripe",
        "handle": "stripe",
        "name": "Stripe",
        "description": "Facturen, betalingen en abonnementen opzoeken.",
        "url": "https://mcp.stripe.com",
        "transport": "streamable_http",
    },
    {
        "id": "intercom",
        "handle": "intercom",
        "name": "Intercom",
        "description": "Klantgesprekken, tickets en helpcenter-artikelen doorzoeken.",
        "url": "https://mcp.intercom.com/mcp",
        "transport": "streamable_http",
    },
    {
        "id": "paypal",
        "handle": "paypal",
        "name": "PayPal",
        "description": "Facturen en transacties raadplegen.",
        "url": "https://mcp.paypal.com/mcp",
        "transport": "streamable_http",
    },
    {
        "id": "zapier",
        "handle": "zapier",
        "name": "Zapier",
        "description": "Duizenden zakelijke apps (zoals Google Slides, Sheets, Teams, Slack) koppelen via Zapier MCP.",
        "url": "https://mcp.zapier.com/api/mcp/mcp",
        "transport": "streamable_http",
    },
    {
        "id": "deepwiki",
        "handle": "deepwiki",
        "name": "DeepWiki",
        "description": "Openbare software-architectuur en documentatie doorzoeken (geen login nodig).",
        "url": "https://mcp.deepwiki.com/mcp",
        "transport": "streamable_http",
    },
]

REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers"


@contextmanager
def database():
    with projects.database() as db:
        db.execute(
            """CREATE TABLE IF NOT EXISTS plugins(
              id TEXT PRIMARY KEY,
              owner TEXT NOT NULL,
              handle TEXT NOT NULL,
              name TEXT NOT NULL,
              description TEXT NOT NULL DEFAULT '',
              url TEXT NOT NULL,
              transport TEXT NOT NULL DEFAULT 'auto',
              token TEXT NOT NULL DEFAULT '',
              headers TEXT NOT NULL DEFAULT '{}',
              tools_cache TEXT NOT NULL DEFAULT '[]',
              enabled INT NOT NULL DEFAULT 1,
              updated TEXT NOT NULL,
              UNIQUE(owner, handle))"""
        )
        yield db


def normalize_handle(raw: str) -> str:
    handle = raw.strip().lstrip("@").lower()
    if not HANDLE_RE.fullmatch(handle):
        raise HTTPException(400, "Gebruik een korte naam met kleine letters, cijfers, - of _ (bijvoorbeeld canva).")
    return handle


def validate_url(url: str) -> str:
    cleaned = url.strip()
    try:
        documents._check(cleaned)
    except ValueError as e:
        raise HTTPException(400, f"Gebruik een geldig openbaar http(s)-adres voor de MCP-server ({e}).") from e
    return cleaned


def validate_headers(headers: dict[str, str] | None) -> dict[str, str]:
    if not headers:
        return {}
    if len(headers) > 20:
        raise HTTPException(400, "Maximaal 20 aangepaste headers per plugin.")
    cleaned: dict[str, str] = {}
    for k, v in headers.items():
        key = k.strip()
        if not HEADER_KEY_RE.fullmatch(key) or key.lower() in FORBIDDEN_HEADERS:
            raise HTTPException(400, f"Ongeldige headernaam: {key}")
        if "\r" in v or "\n" in v or len(v) > 4000:
            raise HTTPException(400, f"Ongeldige waarde voor header: {key}")
        cleaned[key] = v.strip()
    return cleaned


def env_token(handle: str) -> str:
    upper = handle.upper().replace("-", "_")
    for var in (f"{upper}_MCP_TOKEN", f"MCP_{upper}_TOKEN", f"{upper}_API_KEY"):
        val = os.environ.get(var, "").strip()
        if val:
            return val
    return ""


def _normalize_schema(node):
    """Ensure JSON Schema 'const' literals also expose single-value 'enum' for Gemini/OpenAI tool calling."""
    if isinstance(node, list):
        return [_normalize_schema(item) for item in node]
    if not isinstance(node, dict):
        return node
    out = {k: _normalize_schema(v) for k, v in node.items()}
    if "const" in out and "enum" not in out and isinstance(out["const"], (str, int, float, bool)):
        out["enum"] = [out["const"]]
    return out


def unpack(row) -> dict:
    d = dict(row)
    try:
        headers = json.loads(d.pop("headers", "{}") or "{}")
    except json.JSONDecodeError:
        headers = {}
    try:
        tools = json.loads(d.pop("tools_cache", "[]") or "[]")
    except json.JSONDecodeError:
        tools = []
    token = d.pop("token", "") or env_token(d.get("handle", ""))
    d.pop("owner", None)
    d["enabled"] = bool(d["enabled"])
    d["has_token"] = bool(token)
    d["header_keys"] = sorted(headers.keys())
    d["tools"] = [
        {**t, "inputSchema": _normalize_schema(t.get("inputSchema"))} if isinstance(t, dict) else t for t in (tools if isinstance(tools, list) else [])
    ]
    return d


def get_row(db, pid: str, user: str):
    row = db.execute("SELECT * FROM plugins WHERE id=? AND owner=?", (pid, user)).fetchone()
    if not row:
        raise HTTPException(404, "Plugin niet gevonden")
    return row


def _fetch_json(url: str, method: str = "GET", data: bytes | None = None, content_type: str = "application/json") -> dict | None:
    try:
        documents._check(url)
        headers = {"Accept": "application/json", "User-Agent": "jaarverantwoording-zorg-mcp/0.1"}
        if data is not None:
            headers["Content-Type"] = content_type
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        opener = urllib.request.build_opener(documents._Redirects(None))
        with opener.open(req, timeout=15) as resp:
            raw = resp.read(1024 * 1024)
            parsed = json.loads(raw.decode("utf-8", errors="replace"))
            return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def discover_oauth_metadata(mcp_url: str) -> dict:
    """Discover OAuth 2.1 endpoints for an MCP server via RFC 9728 / RFC 8414 well-known metadata."""
    u = urllib.parse.urlsplit(mcp_url)
    origin = f"{u.scheme}://{u.netloc}"
    path = u.path.rstrip("/")
    issuer = origin

    # 1. RFC 9728 Protected Resource Metadata
    for candidate in (f"{origin}/.well-known/oauth-protected-resource{path}", f"{origin}/.well-known/oauth-protected-resource"):
        prm = _fetch_json(candidate)
        if prm and isinstance(prm.get("authorization_servers"), list) and prm["authorization_servers"]:
            srv = str(prm["authorization_servers"][0]).rstrip("/")
            if srv.startswith(("https://", "http://")):
                issuer = srv
                break

    # 2. RFC 8414 OAuth Authorization Server Metadata / OpenID Configuration
    iss = urllib.parse.urlsplit(issuer)
    iss_origin = f"{iss.scheme}://{iss.netloc}"
    iss_path = iss.path.rstrip("/")
    for meta_url in (
        f"{iss_origin}/.well-known/oauth-authorization-server{iss_path}",
        f"{iss_origin}/.well-known/oauth-authorization-server",
        f"{iss_origin}/.well-known/openid-configuration",
    ):
        meta = _fetch_json(meta_url)
        if meta and meta.get("authorization_endpoint") and meta.get("token_endpoint"):
            return meta

    # Fallback standard endpoints on the MCP origin
    return {
        "authorization_endpoint": f"{origin}/authorize",
        "token_endpoint": f"{origin}/token",
        "registration_endpoint": f"{origin}/register",
    }


def register_oauth_client(meta: dict, redirect_uri: str, handle: str) -> tuple[str, str]:
    """Use env client_id if configured, or RFC 7591 Dynamic Client Registration."""
    upper = handle.upper().replace("-", "_")
    env_cid = os.environ.get(f"{upper}_CLIENT_ID", "").strip()
    env_sec = os.environ.get(f"{upper}_CLIENT_SECRET", "").strip()
    if env_cid:
        return env_cid, env_sec

    reg_url = meta.get("registration_endpoint")
    if isinstance(reg_url, str) and reg_url.startswith(("https://", "http://")):
        payload = json.dumps(
            {
                "client_name": "Jaarverantwoording Zorg",
                "redirect_uris": [redirect_uri],
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
                "token_endpoint_auth_method": "none",
            }
        ).encode("utf-8")
        reg = _fetch_json(reg_url, method="POST", data=payload)
        if reg and isinstance(reg.get("client_id"), str) and reg["client_id"]:
            return reg["client_id"], str(reg.get("client_secret") or "")

    raise HTTPException(
        400,
        f"Deze MCP-server ondersteunt geen automatische OAuth-registratie. Stel {upper}_CLIENT_ID in .env in of plak een API-sleutel.",
    )


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _parse_rpc_payload(raw: bytes, content_type: str, expected_id: int | None = None) -> dict:
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        return {}
    if "text/event-stream" in content_type.lower() or text.startswith(("event:", "data:")):
        messages: list[dict] = []
        for line in text.splitlines():
            if line.startswith("data:"):
                payload = line[5:].strip()
                if not payload:
                    continue
                try:
                    obj = json.loads(payload)
                    if isinstance(obj, dict):
                        messages.append(obj)
                except json.JSONDecodeError:
                    continue
        if expected_id is not None:
            for msg in messages:
                if msg.get("id") == expected_id:
                    return msg
        return messages[-1] if messages else {}
    data = json.loads(text)
    if isinstance(data, list):
        if expected_id is not None:
            for item in data:
                if isinstance(item, dict) and item.get("id") == expected_id:
                    return item
        return data[-1] if data and isinstance(data[-1], dict) else {}
    return data if isinstance(data, dict) else {}


class McpAuthRequired(RuntimeError):
    """Raised when an MCP server returns 401/403 so the UI can trigger the OAuth 2.1 browser login."""


def _rpc_post(url: str, payload: dict, req_headers: dict[str, str], session_id: str | None = None) -> tuple[dict, str | None]:
    documents._check(url)
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "User-Agent": "jaarverantwoording-zorg-mcp/0.1",
        **req_headers,
    }
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    opener = urllib.request.build_opener(documents._Redirects(None))
    try:
        with opener.open(req, timeout=MCP_TIMEOUT) as resp:
            new_session = resp.headers.get("Mcp-Session-Id") or resp.headers.get("mcp-session-id") or session_id
            ctype = resp.headers.get("Content-Type", "application/json")
            body = resp.read(10 * 1024 * 1024)
            return _parse_rpc_payload(body, ctype, payload.get("id")), new_session
    except urllib.error.HTTPError as e:
        err_body = e.read(4096).decode("utf-8", errors="replace")
        if e.code in (401, 403):
            raise McpAuthRequired("Inloggen vereist bij deze MCP-server.") from e
        raise RuntimeError(f"MCP-server antwoordde met HTTP {e.code}: {err_body[:200] or e.reason}") from e
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
        raise RuntimeError(f"Verbinding met MCP-server mislukt: {e}") from e


def _auth_headers(token: str, custom_headers: dict[str, str]) -> dict[str, str]:
    merged = dict(custom_headers)
    if token and not any(k.lower() == "authorization" for k in merged):
        merged["Authorization"] = token if token.lower().startswith(("bearer ", "basic ")) else f"Bearer {token}"
    return merged


def _mcp_session_request(url: str, token: str, custom_headers: dict[str, str], method: str, params: dict) -> dict:
    headers = _auth_headers(token, custom_headers)
    init_resp, session_id = _rpc_post(
        url,
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "jaarverantwoording-zorg", "version": "0.1.0"},
            },
        },
        headers,
    )
    if init_resp.get("error"):
        err = init_resp["error"]
        msg = err.get("message") if isinstance(err, dict) else str(err)
        raise RuntimeError(f"MCP initialize mislukt: {msg}")
    try:
        _rpc_post(url, {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}, headers, session_id)
    except RuntimeError:
        pass
    resp, _ = _rpc_post(url, {"jsonrpc": "2.0", "id": 2, "method": method, "params": params}, headers, session_id)
    if resp.get("error"):
        err = resp["error"]
        msg = err.get("message") if isinstance(err, dict) else str(err)
        raise RuntimeError(f"MCP-fout bij {method}: {msg}")
    result = resp.get("result")
    return result if isinstance(result, dict) else {}


def discover_tools(url: str, transport: str, token: str, custom_headers: dict[str, str]) -> list[dict]:
    result = _mcp_session_request(url, token, custom_headers, "tools/list", {})
    raw_tools = result.get("tools")
    if not isinstance(raw_tools, list):
        return []
    cleaned: list[dict] = []
    for item in raw_tools[:60]:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            continue
        name = item["name"].strip()[:64]
        if not name:
            continue
        schema = item.get("inputSchema")
        if not isinstance(schema, dict) or schema.get("type") != "object":
            schema = {"type": "object", "properties": {}}
        else:
            schema = _normalize_schema(schema)
        cleaned.append(
            {
                "name": name,
                "description": str(item.get("description") or "")[:1000],
                "inputSchema": schema,
            }
        )
    return cleaned


def call_mcp_tool(url: str, transport: str, token: str, custom_headers: dict[str, str], tool_name: str, arguments: dict) -> dict:
    result = _mcp_session_request(url, token, custom_headers, "tools/call", {"name": tool_name, "arguments": arguments or {}})
    is_error = bool(result.get("isError"))
    content = result.get("content")
    texts: list[str] = []
    items: list[dict] = []
    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "text" and isinstance(block.get("text"), str):
                texts.append(block["text"])
                items.append({"type": "text", "text": block["text"]})
            elif btype == "resource" and isinstance(block.get("resource"), dict):
                res = block["resource"]
                uri = res.get("uri") or ""
                rtext = res.get("text") or ""
                if uri or rtext:
                    texts.append(f"{uri} {rtext}".strip())
                items.append({"type": "resource", "uri": uri, "text": rtext, "mimeType": res.get("mimeType")})
            elif btype == "resource_link":
                uri = block.get("uri") or block.get("url") or ""
                name = block.get("name") or block.get("title") or uri
                if uri:
                    texts.append(f"[{name}]({uri})")
                items.append({"type": "resource_link", "name": name, "uri": uri})
            else:
                items.append(block)
    structured = result.get("structuredContent")
    joined_text = "\n\n".join(texts).strip()
    if is_error:
        msg = joined_text or "De plugin gaf een foutmelding terug."
        raise RuntimeError(msg)
    compact_items = [b for b in items if b.get("type") != "text"] if len(joined_text) > 10_000 else items
    return {
        "text": joined_text,
        "content": compact_items,
        **({"structuredContent": structured} if structured is not None else {}),
    }


class PluginIn(BaseModel):
    handle: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    url: str = Field(min_length=8, max_length=2000)
    transport: str = Field(default="auto", max_length=30)
    token: str | None = Field(default=None, max_length=4000)
    clear_token: bool = False
    headers: dict[str, str] | None = None
    enabled: bool = True
    sync: bool = True


class PluginCallIn(BaseModel):
    tool: str = Field(min_length=1, max_length=100)
    arguments: dict = Field(default_factory=dict)
    project_id: str | None = None


@router.get("/presets")
def list_presets():
    return PRESETS


def _slug_handle(raw_name: str) -> str:
    slug = raw_name.strip().lower().split("/")[-1]
    slug = re.sub(r"^(mcp-server-|server-|mcp-)", "", slug)
    slug = re.sub(r"(-mcp-server|-mcp|-server)$", "", slug)
    slug = re.sub(r"[^a-z0-9_-]+", "-", slug).strip("-_")
    if len(slug) < 2:
        slug = "plugin"
    return slug[:30]


@router.get("/registry")
def search_registry(q: str = "", limit: int = 25):
    """Search the curated MCP catalog + the live Official MCP Registry (registry.modelcontextprotocol.io) for remote MCP servers."""
    query = q.strip().lower()
    capped = max(1, min(limit, 50))
    results: list[dict] = []
    seen_urls: set[str] = set()

    for p in PRESETS:
        if not query or query in p["name"].lower() or query in p["handle"].lower() or query in p["description"].lower():
            results.append({**p, "source": "verified"})
            seen_urls.add(p["url"].rstrip("/").lower())

    if query:
        params = urllib.parse.urlencode({"search": query, "limit": str(capped), "version": "latest"})
        data = _fetch_json(f"{REGISTRY_URL}?{params}")
        servers = (data or {}).get("servers")
        if isinstance(servers, list):
            for entry in servers:
                srv = entry.get("server") if isinstance(entry, dict) and isinstance(entry.get("server"), dict) else entry
                if not isinstance(srv, dict):
                    continue
                remotes = srv.get("remotes")
                if not isinstance(remotes, list) or not remotes:
                    continue
                chosen_url = ""
                chosen_transport = "auto"
                for rem in remotes:
                    if not isinstance(rem, dict):
                        continue
                    r_url = str(rem.get("url") or "").strip()
                    r_type = str(rem.get("type") or "").strip().lower()
                    if not r_url.startswith("https://") or "{" in r_url:
                        continue
                    try:
                        documents._check(r_url)
                    except ValueError:
                        continue
                    chosen_url = r_url
                    chosen_transport = "sse" if r_type == "sse" else "streamable_http"
                    if r_type in ("streamable-http", "streamable_http"):
                        break
                if not chosen_url:
                    continue
                norm_url = chosen_url.rstrip("/").lower()
                if norm_url in seen_urls:
                    continue
                seen_urls.add(norm_url)
                raw_name = str(srv.get("name") or "").strip()
                handle = _slug_handle(raw_name)
                title = str(srv.get("title") or "").strip() or handle.replace("-", " ").replace("_", " ").title()
                desc = str(srv.get("description") or "").strip() or f"Remote MCP-server ({raw_name})"
                results.append(
                    {
                        "id": f"reg:{raw_name or handle}",
                        "handle": handle,
                        "name": title[:80],
                        "description": desc[:400],
                        "url": chosen_url,
                        "transport": chosen_transport,
                        "source": "registry",
                    }
                )
                if len(results) >= capped:
                    break

    return results[:capped]


@router.get("")
def list_plugins(request: Request):
    user = projects.owner(request)
    with database() as db:
        existing = {r["handle"] for r in db.execute("SELECT handle FROM plugins WHERE owner=?", (user,)).fetchall()}
        for preset in PRESETS:
            if preset["handle"] not in existing and env_token(preset["handle"]):
                db.execute(
                    "INSERT INTO plugins(id,owner,handle,name,description,url,transport,token,headers,tools_cache,enabled,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        uuid.uuid4().hex,
                        user,
                        preset["handle"],
                        preset["name"],
                        preset["description"],
                        preset["url"],
                        preset["transport"],
                        "",
                        "{}",
                        "[]",
                        1,
                        projects.now(),
                    ),
                )
        rows = db.execute("SELECT * FROM plugins WHERE owner=? ORDER BY name COLLATE NOCASE ASC", (user,)).fetchall()
        return ([presentations.plugin()] if presentations.configured() else []) + [unpack(r) for r in rows]


@router.post("", status_code=201)
def create_plugin(body: PluginIn, request: Request):
    user = projects.owner(request)
    handle = normalize_handle(body.handle)
    if handle == "presenton":
        raise HTTPException(400, "@presenton is gereserveerd voor de ingebouwde presentatietool.")
    url = validate_url(body.url)
    transport = body.transport.strip().lower()
    if transport not in TRANSPORTS:
        raise HTTPException(400, "Kies transport: auto, streamable_http of sse.")
    headers = validate_headers(body.headers)
    token = (body.token or "").strip()
    effective_token = token or env_token(handle)
    tools: list[dict] = []
    sync_error = ""
    needs_oauth = False
    if body.sync:
        try:
            tools = discover_tools(url, transport, effective_token, headers)
        except McpAuthRequired as e:
            needs_oauth = not bool(effective_token)
            sync_error = str(e)
        except RuntimeError as e:
            sync_error = str(e)
    pid = uuid.uuid4().hex
    with database() as db:
        existing = db.execute("SELECT id FROM plugins WHERE owner=? AND handle=?", (user, handle)).fetchone()
        if existing:
            raise HTTPException(409, f"Plugin @{handle} bestaat al.")
        db.execute(
            "INSERT INTO plugins(id,owner,handle,name,description,url,transport,token,headers,tools_cache,enabled,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                pid,
                user,
                handle,
                body.name.strip(),
                body.description.strip(),
                url,
                transport,
                token,
                json.dumps(headers),
                json.dumps(tools),
                int(body.enabled),
                projects.now(),
            ),
        )
        out = unpack(get_row(db, pid, user))
    if needs_oauth:
        out["needs_oauth"] = True
    if sync_error:
        out["sync_error"] = sync_error
    return out


@router.get("/{pid}/oauth/start")
def oauth_start(pid: str, request: Request):
    """Start MCP OAuth 2.1 + PKCE login in a popup window."""
    user = projects.owner(request)
    with database() as db:
        row = dict(get_row(db, pid, user))
    url = validate_url(row["url"])
    app_origin = os.environ.get("APP_ORIGIN", "http://localhost:3210").rstrip("/")
    if urllib.parse.urlsplit(url).hostname in LOOPBACK_REDIRECT_HOSTS and urllib.parse.urlsplit(app_origin).hostname not in LOOPBACK_HOSTS:
        # The login then ends on a page that doesn't load; the user pastes its address into the app, which opens
        # the callback below with the same code and state.
        app_origin = "http://127.0.0.1"
    redirect_uri = f"{app_origin}/digimv/plugins/oauth/callback"
    meta = discover_oauth_metadata(url)
    auth_endpoint = meta.get("authorization_endpoint")
    token_endpoint = meta.get("token_endpoint")
    if not isinstance(auth_endpoint, str) or not isinstance(token_endpoint, str):
        raise HTTPException(400, "Geen OAuth-inlogpagina gevonden voor deze MCP-server.")
    validate_url(auth_endpoint)
    validate_url(token_endpoint)
    client_id, client_secret = register_oauth_client(meta, redirect_uri, row["handle"])
    verifier, challenge = _pkce_pair()
    state = secrets.token_urlsafe(24)

    now_ts = time.time()
    for k, v in list(_PENDING_OAUTH.items()):
        if v["expires"] < now_ts:
            _PENDING_OAUTH.pop(k, None)

    _PENDING_OAUTH[state] = {
        "pid": pid,
        "owner": user,
        "handle": row["handle"],
        "name": row["name"],
        "code_verifier": verifier,
        "token_endpoint": token_endpoint,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "expires": now_ts + OAUTH_TTL,
    }
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    if isinstance(meta.get("scopes_supported"), list) and meta["scopes_supported"]:
        params["scope"] = " ".join(str(s) for s in meta["scopes_supported"][:15])
    sep = "&" if "?" in auth_endpoint else "?"
    return RedirectResponse(f"{auth_endpoint}{sep}{urllib.parse.urlencode(params)}", status_code=302)


@router.get("/oauth/callback", response_class=HTMLResponse)
def oauth_callback(request: Request, code: str = "", state: str = "", error: str = "", error_description: str = ""):
    """Complete MCP OAuth 2.1 login, store the access token, sync tools, and notify the opener window."""
    try:
        caller = projects.owner(request)
    except HTTPException:
        return _oauth_html("Inloggen niet gelukt", "Log eerst in bij de applicatie en probeer het opnieuw.", False)
    pending = _PENDING_OAUTH.get(state) if state else None
    if not pending or pending["expires"] < time.time():
        _PENDING_OAUTH.pop(state, None)
        return _oauth_html("Sessie verlopen", "De inlogsessie is verlopen. Sluit dit venster en probeer het opnieuw.", False)
    if pending["owner"] != caller:
        return _oauth_html("Inloggen niet gelukt", "Deze inlogsessie hoort bij een andere gebruiker.", False)
    _PENDING_OAUTH.pop(state, None)
    if error or not code:
        detail = error_description or error or "Toegang geweigerd."
        return _oauth_html("Inloggen niet gelukt", f"De MCP-server meldde: {detail}", False)

    form: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": pending["redirect_uri"],
        "client_id": pending["client_id"],
        "code_verifier": pending["code_verifier"],
    }
    if pending.get("client_secret"):
        form["client_secret"] = pending["client_secret"]

    token_resp = _fetch_json(
        pending["token_endpoint"],
        method="POST",
        data=urllib.parse.urlencode(form).encode("utf-8"),
        content_type="application/x-www-form-urlencoded",
    )
    access_token = str((token_resp or {}).get("access_token") or "").strip()
    if not access_token:
        return _oauth_html("Inloggen mislukt", "De MCP-server gaf geen toegangstoken terug.", False)

    pid = pending["pid"]
    user = pending["owner"]
    with database() as db:
        row = dict(get_row(db, pid, user))
        headers = json.loads(row["headers"] or "{}")
    tools: list[dict] = []
    try:
        tools = discover_tools(row["url"], row["transport"], access_token, headers)
    except Exception:
        # Keep the successful login; the user can retry tool discovery with Sync.
        tools = []
    with database() as db:
        get_row(db, pid, user)
        db.execute(
            "UPDATE plugins SET token=?, tools_cache=?, updated=? WHERE id=? AND owner=?",
            (access_token, json.dumps(tools), projects.now(), pid, user),
        )
    return _oauth_html(
        f"Verbonden met {pending['name']}",
        f"@{pending['handle']} is gekoppeld ({len(tools)} MCP-tools geladen). Dit venster sluit automatisch.",
        True,
        pid,
        pending["handle"],
    )


def _oauth_html(title: str, message: str, ok: bool, pid: str = "", handle: str = "") -> HTMLResponse:
    safe_title = html.escape(title)
    safe_msg = html.escape(message)
    safe_pid = json.dumps(pid)
    safe_handle = json.dumps(handle)
    script = (
        f"if(window.opener){{window.opener.postMessage({{type:'mcp-oauth-complete',ok:{'true' if ok else 'false'},pluginId:{safe_pid},handle:{safe_handle}}},window.location.origin);setTimeout(()=>window.close(),600);}}"
        if ok
        else ""
    )
    body = f"""<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>{safe_title}</title>
<style>body{{font-family:system-ui,sans-serif;display:flex;min-height:90vh;align-items:center;justify-content:center;background:#fafafa;color:#111;margin:0}}
.card{{max-width:24rem;padding:1.75rem;border-radius:1rem;background:#fff;border:1px solid #e4e4e7;text-align:center;box-shadow:0 8px 24px rgb(0 0 0/.06)}}
h1{{font-size:1.15rem;margin:0 0 .5rem}}p{{font-size:.9rem;color:#52525b;margin:0}}</style></head>
<body><div class="card"><h1>{safe_title}</h1><p>{safe_msg}</p></div><script>{script}</script></body></html>"""
    return HTMLResponse(body)


@router.put("/{pid}")
def update_plugin(pid: str, body: PluginIn, request: Request):
    user = projects.owner(request)
    handle = normalize_handle(body.handle)
    if handle == "presenton":
        raise HTTPException(400, "@presenton is gereserveerd voor de ingebouwde presentatietool.")
    url = validate_url(body.url)
    transport = body.transport.strip().lower()
    if transport not in TRANSPORTS:
        raise HTTPException(400, "Kies transport: auto, streamable_http of sse.")
    with database() as db:
        current = get_row(db, pid, user)
        clash = db.execute("SELECT id FROM plugins WHERE owner=? AND handle=? AND id!=?", (user, handle, pid)).fetchone()
        if clash:
            raise HTTPException(409, f"Plugin @{handle} bestaat al.")
        token = "" if body.clear_token else (body.token.strip() if body.token and body.token.strip() else current["token"])
        headers = validate_headers(body.headers) if body.headers is not None else json.loads(current["headers"] or "{}")
        tools = json.loads(current["tools_cache"] or "[]")
    effective_token = token or env_token(handle)
    sync_error = ""
    needs_oauth = False
    if body.sync:
        try:
            tools = discover_tools(url, transport, effective_token, headers)
        except McpAuthRequired as e:
            needs_oauth = not bool(effective_token)
            sync_error = str(e)
        except RuntimeError as e:
            sync_error = str(e)
    with database() as db:
        get_row(db, pid, user)
        db.execute(
            """UPDATE plugins
               SET handle=?, name=?, description=?, url=?, transport=?, token=?, headers=?, tools_cache=?, enabled=?, updated=?
               WHERE id=? AND owner=?""",
            (
                handle,
                body.name.strip(),
                body.description.strip(),
                url,
                transport,
                token,
                json.dumps(headers),
                json.dumps(tools),
                int(body.enabled),
                projects.now(),
                pid,
                user,
            ),
        )
        out = unpack(get_row(db, pid, user))
    if needs_oauth:
        out["needs_oauth"] = True
    if sync_error:
        out["sync_error"] = sync_error
    return out


@router.delete("/{pid}")
def delete_plugin(pid: str, request: Request):
    user = projects.owner(request)
    with database() as db:
        get_row(db, pid, user)
        db.execute("DELETE FROM plugins WHERE id=? AND owner=?", (pid, user))
    return {"ok": True}


@router.post("/{pid}/sync")
def sync_plugin(pid: str, request: Request):
    user = projects.owner(request)
    with database() as db:
        row = dict(get_row(db, pid, user))
    url = validate_url(row["url"])
    headers = json.loads(row["headers"] or "{}")
    effective_token = row["token"] or env_token(row["handle"])
    try:
        tools = discover_tools(url, row["transport"], effective_token, headers)
    except RuntimeError as e:
        raise HTTPException(502, str(e)) from e
    with database() as db:
        get_row(db, pid, user)
        db.execute("UPDATE plugins SET tools_cache=?, updated=? WHERE id=? AND owner=?", (json.dumps(tools), projects.now(), pid, user))
        return unpack(get_row(db, pid, user))


@router.post("/{pid}/call")
def call_plugin(pid: str, body: PluginCallIn, request: Request):
    user = projects.owner(request)
    if pid == "presenton":
        try:
            return {
                "plugin": "presenton",
                "plugin_name": "Presenton",
                "tool": body.tool,
                **presentations.call(body.tool, body.arguments, user, body.project_id),
            }
        except ValidationError as exc:
            raise HTTPException(422, "Controleer de presentatievelden en het slidenummer.") from exc
    with database() as db:
        row = dict(get_row(db, pid, user))
    if not row["enabled"]:
        raise HTTPException(400, f"Plugin @{row['handle']} is uitgeschakeld.")
    url = validate_url(row["url"])
    headers = json.loads(row["headers"] or "{}")
    effective_token = row["token"] or env_token(row["handle"])
    try:
        result = call_mcp_tool(url, row["transport"], effective_token, headers, body.tool, body.arguments)
    except RuntimeError as e:
        raise HTTPException(502, str(e)) from e
    return {
        "plugin": row["handle"],
        "plugin_name": row["name"],
        "tool": body.tool,
        **result,
    }
