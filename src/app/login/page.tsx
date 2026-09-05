"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";

function safeNextPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/account";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setMessage("");

    const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", next);
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo.toString() },
    });

    if (error) {
      setStatus("error");
      setMessage("We could not send your sign-in link. Please try again.");
      return;
    }

    setStatus("sent");
    setMessage("Check your inbox for a secure sign-in link.");
  }

  return (
    <main className="min-h-screen bg-[var(--paper)] px-5 py-12 sm:py-20">
      <section className="mx-auto max-w-md rounded-2xl border border-[var(--line)] bg-white p-6 shadow-sm sm:p-8">
        <Link href="/" className="brand-mark text-lg font-bold">mizoram<span>stay</span></Link>
        <p className="eyebrow mt-8">Welcome back</p>
        <h1 className="serif mt-3 text-4xl leading-tight">Sign in to continue.</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">We’ll email you a one-time sign-in link. No password required.</p>

        {message && <p className={`mt-5 rounded-lg px-4 py-3 text-sm ${status === "error" ? "bg-red-50 text-red-800" : "bg-[var(--sky)] text-[var(--ink)]"}`} role="status">{message}</p>}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-semibold" htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-lg border border-[var(--line)] px-3 py-3 outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]" placeholder="you@example.com" />
          <button type="submit" disabled={status === "sending"} className="w-full rounded-full bg-[var(--forest)] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{status === "sending" ? "Sending link…" : "Email me a sign-in link"}</button>
        </form>
      </section>
    </main>
  );
}
