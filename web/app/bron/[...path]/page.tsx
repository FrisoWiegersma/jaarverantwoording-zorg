import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { BronView } from "./bron-view";

export const metadata: Metadata = { title: "Waar het staat" };

/** One citation on its own page: where a Bron link in Excel lands. */
export default function Bron() {
  return (
    <div className="min-h-dvh">
      <header className="flex h-16 items-center px-5 sm:px-8">
        <Link className="rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" href="/">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-[34rem] px-5 pt-4 pb-16">
        <div className="raised rounded-2xl p-5 sm:p-6">
          <h1 className="mb-5 font-semibold">Waar het staat</h1>
          {/* the citation is in the URL, read on the client */}
          <Suspense fallback={<div className="h-[28rem] animate-pulse rounded-xl bg-muted" />}>
            <BronView />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
