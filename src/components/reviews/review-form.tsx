"use client";

import { FormEvent, useId, useState } from "react";
import { useRouter } from "next/navigation";

type ReviewFormProps = {
  bookingId: string;
  propertyName?: string;
};

type SubmissionState = "idle" | "submitting" | "success" | "error";

function apiError(payload: unknown, fallback: string) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : fallback;
}

export function ReviewForm({ bookingId, propertyName }: ReviewFormProps) {
  const id = useId();
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [state, setState] = useState<SubmissionState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (cleanBody.length < 10) {
      setState("error");
      setMessage("Please write at least 10 characters about your stay.");
      return;
    }

    setState("submitting");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId,
          rating,
          ...(cleanTitle ? { title: cleanTitle } : {}),
          body: cleanBody,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiError(payload, "Unable to submit this review."));

      setState("success");
      setMessage("Thank you. Your review was submitted and will appear after moderation.");
      router.refresh();
    } catch (caught) {
      setState("error");
      setMessage(caught instanceof Error ? caught.message : "Unable to submit this review.");
    }
  }

  const disabled = state === "submitting" || state === "success";
  const fieldClassName = "mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)] disabled:opacity-60";

  return (
    <form className="space-y-5 rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6" onSubmit={handleSubmit} noValidate>
      <div>
        <h2 className="text-xl font-semibold">Review {propertyName ?? "your stay"}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Share an honest account of your completed stay. Reviews are checked before publication.</p>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold">Overall rating</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <label className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-semibold ${rating === value ? "border-[var(--terracotta)] bg-[var(--sand)] text-[var(--terracotta)]" : "border-[var(--line)]"}`} key={value}>
              <input
                className="sr-only"
                type="radio"
                name={`${id}-rating`}
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                disabled={disabled}
              />
              <span aria-hidden="true">★</span> {value}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label className="text-sm font-semibold" htmlFor={`${id}-title`}>Review title <span className="font-normal text-[var(--muted)]">(optional)</span></label>
        <input
          className={fieldClassName}
          id={`${id}-title`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          disabled={disabled}
          placeholder="A memorable hillside stay"
        />
        <p className="mt-1 text-xs text-[var(--muted)]">{title.length}/120 characters</p>
      </div>

      <div>
        <label className="text-sm font-semibold" htmlFor={`${id}-body`}>Your review</label>
        <textarea
          className={fieldClassName}
          id={`${id}-body`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={6}
          minLength={10}
          maxLength={2000}
          required
          disabled={disabled}
          aria-describedby={`${id}-body-help`}
          placeholder="What did you value, and what should future guests know?"
        />
        <p className="mt-1 text-xs text-[var(--muted)]" id={`${id}-body-help`}>{body.length}/2000 characters; minimum 10.</p>
      </div>

      {message && (
        <p className={`rounded-xl p-3 text-sm leading-6 ${state === "error" ? "bg-red-50 text-red-800" : "bg-[var(--sky)] text-[var(--deep)]"}`} role={state === "error" ? "alert" : "status"}>
          {message}
        </p>
      )}

      <button className="rounded-full bg-[var(--terracotta)] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={disabled}>
        {state === "submitting" ? "Submitting…" : state === "success" ? "Submitted for moderation" : "Submit review"}
      </button>
    </form>
  );
}

export default ReviewForm;
