"use client";

import { FormEvent, useId, useState } from "react";
import { useRouter } from "next/navigation";

type ReviewModerationFormProps = {
  reviewId: string;
};

type Decision = "approved" | "rejected";
type ApiError = { error?: unknown };

function getErrorMessage(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as ApiError).error;
    if (typeof error === "string") return error;
  }
  return "Unable to moderate this review. Please try again.";
}

export default function ReviewModerationForm({ reviewId }: ReviewModerationFormProps) {
  const router = useRouter();
  const formId = useId();
  const [decision, setDecision] = useState<Decision>("approved");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedNotes = notes.trim();
    if (trimmedNotes.length < 2) {
      setFormError("Add moderation notes before recording a decision.");
      return;
    }
    if (trimmedNotes.length > 2000) {
      setFormError("Moderation notes must be 2000 characters or fewer.");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/v1/admin/reviews/${encodeURIComponent(reviewId)}/moderate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, notes: trimmedNotes }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload));

      setSuccessMessage(`Review ${decision}. Updating the moderation queue…`);
      setNotes("");
      router.refresh();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : getErrorMessage(null));
    } finally {
      setIsSubmitting(false);
    }
  }

  const fieldClassName = "mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-[var(--ink)] outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]";

  return <section className="rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby={`${formId}-heading`}>
    <h2 id={`${formId}-heading`} className="text-xl font-semibold">Moderation decision</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Approval publishes the review immediately. Rejection keeps it private. Notes are required for an accountable audit trail.</p>

    <form className="mt-6 space-y-5" onSubmit={handleSubmit} noValidate>
      <fieldset disabled={isSubmitting}>
        <legend className="text-sm font-semibold">Decision</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {([
            ["approved", "Approve and publish"],
            ["rejected", "Reject and keep private"],
          ] as const).map(([value, label]) => <label className="flex items-center gap-3 rounded-xl border border-[var(--line)] p-3 text-sm" key={value}>
            <input type="radio" name={`${formId}-decision`} value={value} checked={decision === value} onChange={() => setDecision(value)} />
            <span className="font-semibold">{label}</span>
          </label>)}
        </div>
      </fieldset>

      <div>
        <label className="text-sm font-semibold" htmlFor={`${formId}-notes`}>Moderation notes</label>
        <textarea
          className={fieldClassName}
          id={`${formId}-notes`}
          rows={6}
          minLength={2}
          maxLength={2000}
          required
          disabled={isSubmitting}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Record the policy basis and relevant review details for this decision. Do not include passwords, tokens, payment data, or other secrets."
        />
        <p className="mt-1 text-right text-xs text-[var(--muted)]">{notes.length}/2000</p>
      </div>

      <button className="w-full rounded-full bg-[var(--forest)] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Recording decision…" : `Submit ${decision === "approved" ? "approval" : "rejection"}`}
      </button>
    </form>

    {formError && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900" role="alert">{formError}</p>}
    {successMessage && <p className="mt-4 rounded-xl bg-[var(--sky)] p-3 text-sm text-[var(--forest)]" role="status">{successMessage}</p>}
  </section>;
}
