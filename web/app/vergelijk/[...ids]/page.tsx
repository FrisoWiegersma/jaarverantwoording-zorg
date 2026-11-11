import type { Metadata } from "next";
import { Suspense, ViewTransition } from "react";
import { CompareView } from "./compare-view";

export const metadata: Metadata = { title: "Vergelijken · Jaarverslagen zorg" };

/** Two to four organisations' key figures side by side, straight from DigiMV, without asking the model. */
export default function Vergelijk() {
  return (
    // the organisations are in the URL, read on the client
    <ViewTransition default="none" enter="page" exit="page"><Suspense fallback={<div className="h-dvh" />}>
      <CompareView />
    </Suspense></ViewTransition>
  );
}
