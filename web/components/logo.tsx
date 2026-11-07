/** A highlighted line of text: the product in one mark. */
export function Logo() {
  return (
    <span className="flex shrink-0 items-center gap-2.5 whitespace-nowrap font-semibold tracking-[-0.01em]">
      <svg aria-hidden="true" className="size-7" viewBox="0 0 28 28">
        <rect className="fill-marker" height="28" rx="8" width="28" />
        <path className="stroke-marker-ink" d="M8 11h12M8 17h7" strokeLinecap="round" strokeWidth="2.4" />
      </svg>
      {/* On a phone the header holds four buttons: the mark alone, the name for screen readers. */}
      <span className="max-sm:sr-only">Jaarverslagen zorg</span>
    </span>
  );
}
