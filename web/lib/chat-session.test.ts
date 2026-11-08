import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationId, reconnectOnReturn, rememberConversation } from "./chat-session.ts";

test("URLs retain stable stream IDs and reject path or query injection", () => {
  assert.equal(conversationId(new URL("https://zorg.test/?gesprek=chat_123-ABC")), "chat_123-ABC");
  for (const id of ["..", "a/b", "x?y", "x".repeat(101)]) assert.equal(conversationId(new URL(`https://zorg.test/?gesprek=${encodeURIComponent(id)}`)), null);
});

test("a frozen phone request is explicitly reconnected on return, once, without submitting a new question", async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const win = Object.assign(new EventTarget(), {
    location: { href: "https://zorg.test/projecten/p?vraag=test" },
    history: { state: { saved: true }, replaceState: (_state: unknown, _title: string, url: URL) => { win.location.href = String(url); } },
  });
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  let calls = 0;
  let release: () => void = () => {};
  let running = true;
  const cleanup = reconnectOnReturn(() => running, async (shouldResume) => {
    calls++;
    assert.equal(shouldResume(), true);
    await new Promise<void>((resolve) => { release = resolve; });
  });
  try {
    rememberConversation("stable-chat");
    assert.equal(win.location.href, "https://zorg.test/projecten/p?gesprek=stable-chat");
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(calls, 0);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("online"));
    assert.equal(calls, 1);
    release(); await new Promise((resolve) => setImmediate(resolve));
    win.dispatchEvent(new Event("online"));
    assert.equal(calls, 2);
    release(); await new Promise((resolve) => setImmediate(resolve));
    running = false;
    win.dispatchEvent(new Event("online"));
    assert.equal(calls, 2);
    cleanup(); running = true;
    win.dispatchEvent(new Event("online"));
    assert.equal(calls, 2);
    rememberConversation(null);
    assert.equal(win.location.href, "https://zorg.test/projecten/p");
  } finally {
    cleanup();
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else Reflect.deleteProperty(globalThis, "document");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
  }
});
