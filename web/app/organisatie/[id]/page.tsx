import type { Metadata } from "next";
import { Suspense } from "react";
import { ProfileView } from "./profile-view";

export const metadata: Metadata = { title: "Kerncijfers · Jaarverslagen zorg" };

/** An organisation's key figures straight from DigiMV, without asking the model: what ⌘K's "Kerncijfers" opens. */
export default function Organisatie() {
  return (
    // the organisation is in the URL, read on the client
    <Suspense fallback={<div className="h-dvh" />}>
      <ProfileView />
    </Suspense>
  );
}
