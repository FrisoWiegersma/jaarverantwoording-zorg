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

// Before first paint: the saved theme, else the OS setting, which it keeps following until a choice is saved.
const THEME_SCRIPT = `(function(){var r=document.documentElement,m=matchMedia("(prefers-color-scheme: dark)");function saved(){try{return localStorage.getItem("theme")}catch(e){return null}}function apply(){var t=saved();r.classList.toggle("dark",t?t==="dark":m.matches)}apply();m.addEventListener("change",apply)})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="nl" className={`${atkinson.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
