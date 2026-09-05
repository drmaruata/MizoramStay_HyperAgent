"use client";

import { FormEvent, useId, useState } from "react";
import { useRouter } from "next/navigation";

type HostResponseFormProps = {
  reviewId: string;
  guestName?: string;
};

type SubmissionState = "idle" | "submitting" | "success" | "error";

function apiError(payload: unknown, fallback: string) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : fallback;
}

export function HostResponseForm({ reviewId, guestName }: HostResponseFormProps) {
  const id = useId();
  const router = useRouter();
  const [responseText, setResponseText] = useState("");
  const [state, setState] = useState<SubmissionState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = responseText.trim();
    if (response.length < 2) {
      setState("error");
      setMessage("Please write a response before submitting.");
      return;
    }

    setState("submitting");
    setMessage(null);
    try {
      const result = await fetch(`/api/v1/reviews/${encodeURIComponent(reviewId)}/response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      const payload: unknown = await result.json().catch(() => null);
      if (!result.ok) throw new Error(apiError(payload, "Unable to add your response."));

      setState("success");
      setMessage("Your response has been added.");
      router.refresh();
    } catch (caught) {
      setState("error");
      setMessage(caught instanceof Error ? caught.message : "Unable to add your response.");
    }
  }

  const disabled = state === "submitting" || state === "success";

  return (
    <form className="mt-5 border-t border-[var(--line)] pt-5" onSubmit={handleSubmit} noValidate>
      <label className="text-sm font-semibold" htmlFor={`${id}-response`}>Respond{guestName ? ` to ${guestName}` : " to this review"}</label>
      <p className="mt-1 text-sm leading-6 text-[var(--muted)]">Your public response is final, so keep it thoughtful and avoid sharing private guest details.</p>
      <textarea
        className="mt-3 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)] disabled:opacity-60"
        id={`${id}-response`}
        value={responseText}
        onChange={(event) => setResponseText(event.target.value)}
        rows={4}
        minLength={2}
        maxLength={2000}
        required
        disabled={disabled}
        aria-describedby={`${id}-response-help`}
        placeholder="Thank your guest or add helpful context for future travellers."
      />
      <p className="mt-1 text-xs text-[var(--muted)]" id={`${id}-response-help`}>{responseText.length}/2000 characters</p>

      {message && (
        <p className={`mt-3 rounded-xl p-3 text-sm leading-6 ${state === "error" ? "bg-red-50 text-red-800" : "bg-[var(--sky)] text-[var(--deep)]"}`} role={state === "error" ? "alert" : "status"}>
          {message}
        </p>
      )}

      <button className="mt-4 rounded-full bg-[var(--terracotta)] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={disabled}>
        {state === "submitting" ? "Sending…" : state === "success" ? "Response sent" : "Publish response"}
      </button>
    </form>
  );
}

export default HostResponseForm;
