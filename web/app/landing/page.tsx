import type { Metadata } from "next";
import { ViewTransition } from "react";
import { LandingPage } from "@/components/landing-page";

export const metadata: Metadata = {
  title: "Jaarverslagen zorg — Van jaarverslag naar controleerbaar antwoord",
  description:
    "Doorzoek openbare zorgdata en je eigen dossiers. Vergelijk zorgorganisaties en controleer het antwoord met de exacte passage uit de bron.",
};

export default function Page() {
  return (
    <ViewTransition default="none" enter="page" exit="page">
      <LandingPage />
    </ViewTransition>
  );
}
