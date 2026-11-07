import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next } from "next/font/google";
import "./globals.css";

// Drawn by the Braille Institute for readers with low vision: clear 1/l/I and 0/O, open figures.
const atkinson = Atkinson_Hyperlegible_Next({
  variable: "--font-atkinson",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Jaarverslagen zorg",
  description: "Vraag het de jaarverslagen van Nederlandse zorgorganisaties. Elk bedrag met de pagina waar het staat.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="nl" className={`${atkinson.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
