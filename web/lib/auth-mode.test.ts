import assert from "node:assert/strict";
import test from "node:test";
import { allowedEmail, authMode, IDENTITY, isPublic, trustedHeaders } from "./auth-mode.ts";

test("builtin unless AUTH_MODE says cloudflare", () => {
  assert.equal(authMode(undefined), "builtin");
  assert.equal(authMode(""), "builtin");
  assert.equal(authMode(" Cloudflare "), "cloudflare");
  assert.equal(authMode("none"), "builtin", "an unknown value never turns the login off");
});

test("the browser cannot claim to be someone; the session decides", () => {
  const forged = new Headers({ [IDENTITY]: "victim@example.test", cookie: "a=1" });
  assert.equal(trustedHeaders(forged, null).get(IDENTITY), null);
  assert.equal(trustedHeaders(forged, "me@example.test").get(IDENTITY), "me@example.test");
  assert.equal(trustedHeaders(forged, null).get("cookie"), "a=1");
});

test("AUTH_ALLOWED_EMAILS takes addresses and @domains", () => {
  assert.ok(allowedEmail("anyone@x.test", ""));
  assert.ok(allowedEmail("Jan@Bureau.nl", "@bureau.nl, piet@elders.nl"));
  assert.ok(allowedEmail("piet@elders.nl", "@bureau.nl, piet@elders.nl"));
  assert.ok(!allowedEmail("jan@bureau.nl.evil.test", "@bureau.nl"));
  assert.ok(!allowedEmail("klaas@elders.nl", "@bureau.nl, piet@elders.nl"));
  assert.ok(!allowedEmail(undefined, "@bureau.nl"));
});

test("private paths are never public, whatever their extension", () => {
  for (const p of ["/login", "/api/auth/sign-in/email", "/landing", "/demo.webp"]) assert.ok(isPublic(p), p);
  for (const p of ["/", "/projecten", "/api/chat", "/digimv/projects", "/digimv/projects/a/documents/b/pages/1.png", "/api/xlsx/x.xlsx"]) assert.ok(!isPublic(p), p);
  for (const p of ["/DIGIMV/documents/2024/x/pages/3.png", "/Api/xlsx/x.xlsx", "/organisatie/x.y", "/bron/a/b.pdf", "/projecten/p.json"]) assert.ok(!isPublic(p), p);
});
