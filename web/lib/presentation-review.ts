/** Deliver actual slide pixels to the model, rather than JSON URLs it cannot see. */
export function presentationReviewOutput(output: unknown, supportsImages = true) {
  const result = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const { images, ...details } = result;
  const frames = Array.isArray(images) ? images.slice(0, 5).filter((v): v is { slide: number; mediaType: string; data: string } =>
    v && typeof v === "object" && typeof v.slide === "number" && v.mediaType === "image/jpeg" && typeof v.data === "string" && v.data.length <= 2_000_000) : [];
  return {
    type: "content" as const,
    value: [
      { type: "text" as const, text: JSON.stringify({ ...details, visual_review_available: supportsImages && frames.length > 0, ...(!supportsImages ? { limitation: "Dit model ondersteunt geen visuele controle. Beweer niet dat de slides visueel zijn gecontroleerd." } : {}) }) },
      ...(supportsImages ? frames.flatMap((frame) => [
        { type: "text" as const, text: `Slide ${frame.slide}` },
        { type: "image-data" as const, data: frame.data, mediaType: frame.mediaType },
      ]) : []),
    ],
  };
}
