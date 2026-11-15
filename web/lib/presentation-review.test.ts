import assert from "node:assert/strict";
import { test } from "node:test";
import { presentationReviewOutput } from "./presentation-review.ts";

test("review sends actual rendered images and labels to the model", () => {
  const result = presentationReviewOutput({ presentation_id: "owned", images: [{ slide: 2, mediaType: "image/jpeg", data: "actual-slide-bytes" }], issues: [{ problem: "placeholder_images" }] });
  assert.equal(result.type, "content");
  assert.equal(result.value[1].type, "text");
  assert.equal(result.value[2].type, "image-data");
  assert.match(result.value[0].type === "text" ? result.value[0].text : "", /placeholder_images/);
});

test("text-only models receive a truthful limitation and no image payload", () => {
  const result = presentationReviewOutput({ images: [{ slide: 1, mediaType: "image/jpeg", data: "pixels" }] }, false);
  assert.equal(result.value.length, 1);
  assert.match(result.value[0].type === "text" ? result.value[0].text : "", /visual_review_available":false/);
});
