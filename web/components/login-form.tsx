"use client";

/**
 * Based on Watermelon UI's auth-07 block (https://ui.watermelon.sh/block/auth-07, MIT): the split layout, pill fields
 * and the staggered spring entrance. Changed for this app: email and password through the built-in login (Better
 * Auth), one form that swaps between signing in and creating an account, Dutch copy, the app's theme tokens, and
 * the kokonut ribbon (background-paths) with the product's promise where the block had a photo. No Google button
 * and no terms box: neither exists here.
 */

import { Eye, EyeOff, Loader2 } from "lucide-react";
import { AnimatePresence, MotionConfig, motion, type Variants } from "motion/react";
import { type FormEvent, useId, useState } from "react";
import BackgroundPaths from "@/components/kokonutui/background-paths";
import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

const container: Variants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.15 } } };
const item: Variants = { hidden: { opacity: 0, y: 15 }, visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } } };
// The swap between the two forms, from Watermelon's swap-form: a short blur and lift.
const swap = { initial: { opacity: 0, y: -8, filter: "blur(4px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" }, exit: { opacity: 0, y: 8, filter: "blur(4px)" }, transition: { duration: 0.2 } };

const COPY = {
  signin: { title: "Welkom terug", sub: "Meld je aan om verder te gaan met je vragen en projecten.", button: "Inloggen", busy: "Inloggen…", other: "Nog geen account?", switch: "Maak er een" },
  signup: { title: "Maak je account", sub: "Je gesprekken en projecten blijven bewaard en zijn alleen voor jou.", button: "Account maken", busy: "Account maken…", other: "Heb je al een account?", switch: "Log in" },
};

/** Better Auth's error codes, said in Dutch; anything else gets a general line. */
const ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Dat e-mailadres en wachtwoord horen niet bij elkaar.",
  USER_ALREADY_EXISTS: "Er is al een account met dit e-mailadres. Log in.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Er is al een account met dit e-mailadres. Log in.",
  PASSWORD_TOO_SHORT: "Kies een wachtwoord van minstens 10 tekens.",
  PASSWORD_TOO_LONG: "Dat wachtwoord is te lang.",
  INVALID_EMAIL: "Dat is geen geldig e-mailadres.",
  EMAIL_NOT_ALLOWED: "Dit e-mailadres mag hier geen account maken. Vraag de beheerder.",
  EMAIL_PASSWORD_SIGN_UP_DISABLED: "Nieuwe accounts maken staat hier uit. Vraag de beheerder.",
};

const FIELD = "w-full rounded-full border bg-background px-5 py-3 text-[0.95rem] placeholder:text-muted-foreground/70 transition-colors focus-visible:border-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-foreground disabled:opacity-60";

export function LoginForm() {
  const uid = useId();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copy = COPY[mode];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const name = email.split("@")[0] || email;
    try {
      const { error } = mode === "signin" ? await authClient.signIn.email({ email, password }) : await authClient.signUp.email({ email, password, name });
      if (error) throw error;
    } catch (e) {
      // An API error has a code; a dropped connection does not.
      const code = (e as { code?: string } | null)?.code ?? "";
      setError(ERRORS[code] ?? "Dat lukte niet. Probeer het opnieuw.");
      setBusy(false);
      return;
    }
    // ?next= comes from the address bar: only a page on this site. Parsing, not prefix checks: browsers read /%5Cevil.example as another site.
    const next = new URL(new URLSearchParams(window.location.search).get("next") ?? "/", window.location.origin);
    window.location.assign(next.origin === window.location.origin ? next.pathname + next.search + next.hash : "/");
  };

  const toggle = () => {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setError("");
  };

  return (
    <MotionConfig reducedMotion="user">
      <main className="flex min-h-dvh w-full bg-background text-foreground">
        <div className="relative flex w-full flex-col lg:w-1/2">
          <div className="absolute top-0 left-0 p-5 sm:p-8">
            <Logo />
          </div>

          <div className="flex flex-1 items-center justify-center px-4 pt-24 pb-10 sm:px-10">
            <motion.div animate="visible" className="w-full max-w-[420px]" initial="hidden" variants={container}>
              <motion.div className="mb-8" variants={item}>
                <AnimatePresence initial={false} mode="wait">
                  <motion.div key={mode} {...swap}>
                    <h1 className="mb-2 font-semibold text-3xl tracking-tight md:text-4xl">{copy.title}</h1>
                    <p className="text-muted-foreground">{copy.sub}</p>
                  </motion.div>
                </AnimatePresence>
              </motion.div>

              <form className="flex flex-col gap-4" onSubmit={submit}>
                <motion.div className="flex flex-col gap-2" variants={item}>
                  <label className="font-medium text-sm" htmlFor={`${uid}-email`}>
                    E-mailadres
                  </label>
                  <input autoComplete="email" className={FIELD} disabled={busy} id={`${uid}-email`} inputMode="email" onChange={(e) => setEmail(e.target.value)} placeholder="naam@organisatie.nl" required type="email" value={email} />
                </motion.div>

                <motion.div className="flex flex-col gap-2" variants={item}>
                  <label className="font-medium text-sm" htmlFor={`${uid}-password`}>
                    Wachtwoord
                  </label>
                  <div className="relative">
                    <input
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                      className={cn(FIELD, "pr-12")}
                      disabled={busy}
                      id={`${uid}-password`}
                      minLength={mode === "signup" ? 10 : undefined}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === "signup" ? "Minstens 10 tekens" : "Je wachtwoord"}
                      required
                      type={show ? "text" : "password"}
                      value={password}
                    />
                    <button
                      aria-label={show ? "Verberg wachtwoord" : "Toon wachtwoord"}
                      aria-pressed={show}
                      className="absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setShow((s) => !s)}
                      type="button"
                    >
                      {show ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
                    </button>
                  </div>
                </motion.div>

                <AnimatePresence initial={false}>
                  {error && (
                    <motion.p animate={{ opacity: 1, height: "auto" }} className="overflow-hidden text-destructive text-sm" exit={{ opacity: 0, height: 0 }} initial={{ opacity: 0, height: 0 }} role="alert">
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>

                <motion.div className="mt-1" variants={item}>
                  <motion.button
                    className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 font-semibold text-primary-foreground transition-[filter,opacity] hover:brightness-110 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                    disabled={busy}
                    type="submit"
                    whileTap={{ scale: 0.98 }}
                  >
                    {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                    <AnimatePresence initial={false} mode="wait">
                      <motion.span key={`${mode}-${busy}`} {...swap}>
                        {busy ? copy.busy : copy.button}
                      </motion.span>
                    </AnimatePresence>
                  </motion.button>
                </motion.div>
              </form>

              <motion.p className="mt-6 text-muted-foreground text-sm" variants={item}>
                {copy.other}{" "}
                <button className="rounded font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" disabled={busy} onClick={toggle} type="button">
                  {copy.switch}
                </button>
              </motion.p>
            </motion.div>
          </div>
        </div>

        <div className="hidden p-4 lg:block lg:w-1/2">
          <BackgroundPaths angle={-8} className="h-full min-h-0 overflow-hidden rounded-[2rem] bg-muted/50 px-12 text-foreground dark:bg-card" count={14} interactive speed={0.25} spread={0.34}>
            <div className="max-w-md">
              <p className="font-semibold text-3xl leading-tight tracking-tight">Bij elk cijfer zie je waar het staat.</p>
              <p className="mt-3 text-muted-foreground">Jaarverslagen, DigiMV, CBS en overheidsdocumenten, met de pagina erbij.</p>
            </div>
          </BackgroundPaths>
        </div>
      </main>
    </MotionConfig>
  );
}
