/** A highlighted line of text: the product in one mark. */
export function Logo() {
  return (
    <span className="flex items-center gap-2.5 font-semibold tracking-[-0.01em]">
      <svg aria-hidden="true" className="size-7" viewBox="0 0 28 28">
        <rect className="fill-marker" height="28" rx="8" width="28" />
        <path className="stroke-marker-ink" d="M8 11h12M8 17h7" strokeLinecap="round" strokeWidth="2.4" />
      </svg>
      Jaarverslagen zorg
    </span>
  );
}
