"use client";

import { FormEvent, useId, useState } from "react";
import { useRouter } from "next/navigation";

type VerificationDecisionFormProps = {
  requestId: string;
  status: "submitted" | "in_review" | "changes_requested" | "approved" | "rejected";
  reviewLevel: number;
  reviewerId: string | null;
  currentUserId: string;
};

type Decision = "approved" | "changes_requested" | "rejected";
type ChangeItem = { fieldName: string; instruction: string };

type ApiError = { error?: unknown };

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as ApiError).error;
    if (typeof error === "string") return error;
  }
  return fallback;
}

export default function VerificationDecisionForm({
  requestId,
  status,
  reviewLevel: initialReviewLevel,
  reviewerId,
  currentUserId,
}: VerificationDecisionFormProps) {
  const router = useRouter();
  const formId = useId();
  const [decision, setDecision] = useState<Decision>("approved");
  const [reviewLevel, setReviewLevel] = useState(String(initialReviewLevel));
  const [notes, setNotes] = useState("");
  const [changeItems, setChangeItems] = useState<ChangeItem[]>([{ fieldName: "", instruction: "" }]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isAssignedToCurrentUser = status === "in_review" && reviewerId === currentUserId;
  const canClaim = status === "submitted";
  const isClosed = status === "changes_requested" || status === "approved" || status === "rejected";
  const fieldClassName = "mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-[var(--ink)] outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]";

  function updateChangeItem(index: number, field: keyof ChangeItem, value: string) {
    setChangeItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  }

  function addChangeItem() {
    setChangeItems((current) => [...current, { fieldName: "", instruction: "" }]);
  }

  function removeChangeItem(index: number) {
    setChangeItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function postDecision(body: object, success: string) {
    setIsSubmitting(true);
    setFormError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/verifications/${encodeURIComponent(requestId)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Unable to update this review. Please try again."));
      setSuccessMessage(success);
      router.refresh();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Unable to update this review. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleClaim() {
    await postDecision(
      { action: "claim", reviewLevel: Number(reviewLevel) },
      "Case claimed. You can now record a decision.",
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedNotes = notes.trim();
    const requestedChanges = decision === "changes_requested"
      ? changeItems.map((item) => ({ fieldName: item.fieldName.trim(), instruction: item.instruction.trim() }))
      : [];

    if ((decision === "changes_requested" || decision === "rejected") && !trimmedNotes) {
      setFormError("Add review notes before submitting this decision.");
      return;
    }
    if (decision === "changes_requested" && requestedChanges.some((item) => !item.fieldName || !item.instruction)) {
      setFormError("Complete both fields for every requested change.");
      return;
    }

    await postDecision({
      action: "decide",
      decision,
      reviewLevel: Number(reviewLevel),
      notes: trimmedNotes || undefined,
      changeRequests: requestedChanges,
    }, `Decision recorded: ${decision.replace("_", " ")}.`);
  }

  if (isClosed) {
    return <section className="rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby={`${formId}-heading`}>
      <h2 id={`${formId}-heading`} className="text-xl font-semibold">Decision recorded</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">This marketplace review is closed. Select another case from the queue to continue.</p>
    </section>;
  }

  if (status === "in_review" && !isAssignedToCurrentUser) {
    return <section className="rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby={`${formId}-heading`}>
      <h2 id={`${formId}-heading`} className="text-xl font-semibold">Assigned to another reviewer</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Only the assigned reviewer can submit the marketplace decision for this case.</p>
    </section>;
  }

  return <section className="rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby={`${formId}-heading`}>
    <h2 id={`${formId}-heading`} className="text-xl font-semibold">{canClaim ? "Claim case" : "Record decision"}</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Approval is an internal publishing decision for Mizoramstay only. It is not a government certification or endorsement.</p>
    <label className="mt-5 block text-sm font-semibold" htmlFor={`${formId}-review-level`}>Review level</label>
    <select className={fieldClassName} id={`${formId}-review-level`} value={reviewLevel} onChange={(event) => setReviewLevel(event.target.value)}>
      {[0, 1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>Level {level}</option>)}
    </select>

    {canClaim ? <button className="mt-6 w-full rounded-full bg-[var(--deep)] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={handleClaim} disabled={isSubmitting}>{isSubmitting ? "Claiming…" : "Claim for review"}</button> : <form className="mt-6 space-y-5" onSubmit={handleSubmit} noValidate>
      <fieldset>
        <legend className="text-sm font-semibold">Decision</legend>
        <div className="mt-2 grid gap-2">
          {([
            ["approved", "Approve for marketplace publication"],
            ["changes_requested", "Request changes"],
            ["rejected", "Reject submission"],
          ] as const).map(([value, label]) => <label className="flex items-center gap-3 rounded-xl border border-[var(--line)] p-3 text-sm" key={value}>
            <input type="radio" name={`${formId}-decision`} value={value} checked={decision === value} onChange={() => setDecision(value)} />
            <span className="font-semibold">{label}</span>
          </label>)}
        </div>
      </fieldset>

      <div>
        <label className="text-sm font-semibold" htmlFor={`${formId}-notes`}>Reviewer notes {decision === "approved" && <span className="font-normal text-[var(--muted)]">(optional)</span>}</label>
        <textarea className={fieldClassName} id={`${formId}-notes`} rows={5} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Record the evidence considered and a clear reason for this decision." />
      </div>

      {decision === "changes_requested" && <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Requested changes</legend>
        {changeItems.map((item, index) => <div className="rounded-xl bg-[var(--sand)] p-4" key={index}>
          <div>
            <label className="text-sm font-semibold" htmlFor={`${formId}-change-field-${index}`}>Listing field</label>
            <input className={fieldClassName} id={`${formId}-change-field-${index}`} maxLength={120} value={item.fieldName} onChange={(event) => updateChangeItem(index, "fieldName", event.target.value)} placeholder="For example: exterior photo" />
          </div>
          <div className="mt-3">
            <label className="text-sm font-semibold" htmlFor={`${formId}-change-instruction-${index}`}>Instruction</label>
            <textarea className={fieldClassName} id={`${formId}-change-instruction-${index}`} rows={3} maxLength={1000} value={item.instruction} onChange={(event) => updateChangeItem(index, "instruction", event.target.value)} placeholder="Explain exactly what the host needs to update." />
          </div>
          {changeItems.length > 1 && <button className="mt-3 text-sm font-semibold text-[var(--terracotta)] underline underline-offset-4" type="button" onClick={() => removeChangeItem(index)}>Remove item</button>}
        </div>)}
        {changeItems.length < 25 && <button className="text-sm font-semibold text-[var(--forest)] underline underline-offset-4" type="button" onClick={addChangeItem}>Add another change</button>}
      </fieldset>}

      <button className="w-full rounded-full bg-[var(--forest)] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmitting}>{isSubmitting ? "Submitting…" : "Submit decision"}</button>
    </form>}

    {formError && <p className="mt-4 rounded-xl bg-[var(--sand)] p-3 text-sm text-[var(--terracotta)]" role="alert">{formError}</p>}
    {successMessage && <p className="mt-4 rounded-xl bg-[var(--sky)] p-3 text-sm text-[var(--forest)]" role="status">{successMessage}</p>}
  </section>;
}
