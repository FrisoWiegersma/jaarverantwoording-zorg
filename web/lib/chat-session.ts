/** Stable conversation URLs survive a phone discarding its page. Never persist message contents in browser storage. */
export function conversationId(url: URL) {
  const id = url.searchParams.get("gesprek");
  return id && /^[\w-]{1,100}$/.test(id) ? id : null;
}

export function rememberConversation(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("gesprek", id);
  else url.searchParams.delete("gesprek");
  url.searchParams.delete("vraag");
  window.history.replaceState(window.history.state, "", url);
}

/** A suspended phone fetch can remain pending forever. Detach it before explicitly replaying the server stream. */
export function reconnectOnReturn(isRunning: () => boolean, reconnect: (shouldResume: () => boolean) => Promise<void>) {
  let active = true;
  let hidden = document.visibilityState !== "visible";
  let pending = false;
  const shouldResume = () => active && document.visibilityState === "visible";
  const resume = () => {
    if (!shouldResume() || !isRunning() || pending) return;
    pending = true;
    reconnect(shouldResume).catch(() => {}).finally(() => { pending = false; });
  };
  const visible = () => {
    if (document.visibilityState !== "visible") { hidden = true; return; }
    if (hidden) { hidden = false; resume(); }
  };
  const restored = (event: PageTransitionEvent) => { if (event.persisted) resume(); };
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("online", resume);
  window.addEventListener("pageshow", restored);
  return () => {
    active = false;
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("online", resume);
    window.removeEventListener("pageshow", restored);
  };
}
