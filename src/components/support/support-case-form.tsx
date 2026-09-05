"use client";

import { FormEvent, useId, useState } from "react";
import { useRouter } from "next/navigation";

export type SupportBookingOption = {
  id: string;
  label: string;
};

type ApiError = { error?: unknown };
type CreatedCase = { id?: unknown };

type SupportCaseFormProps = {
  bookings?: SupportBookingOption[];
};

type SupportCaseMessageFormProps = {
  caseId: string;
  disabled?: boolean;
  allowInternal?: boolean;
};

type SupportCaseAdminActionsProps = {
  caseId: string;
  status: "open" | "in_progress" | "waiting_on_customer" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  assignedTo: string | null;
  currentUserId: string;
};

const fieldClassName = "mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-3 text-[var(--ink)] outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)] disabled:cursor-not-allowed disabled:opacity-60";

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as ApiError).error;
    if (typeof error === "string") return error;
  }
  return fallback;
}

export default function SupportCaseForm({ bookings = [] }: SupportCaseFormProps) {
  const router = useRouter();
  const id = useId();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("booking");
  const [priority, setPriority] = useState("normal");
  const [bookingId, setBookingId] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setFeedback(null);

    try {
      const response = await fetch("/api/v1/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          message: message.trim(),
          category,
          priority,
          bookingId: bookingId || null,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Unable to open a support case."));

      const supportCase = payload && typeof payload === "object" && "supportCase" in payload
        ? payload.supportCase as CreatedCase
        : null;
      if (!supportCase || typeof supportCase.id !== "string") {
        throw new Error("The support case was created, but its reference was unavailable. Refresh the page to view it.");
      }

      router.push(`/support?case=${encodeURIComponent(supportCase.id)}`);
      router.refresh();
    } catch (caught) {
      setState("error");
      setFeedback(caught instanceof Error ? caught.message : "Unable to open a support case.");
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      <div>
        <label className="text-sm font-semibold" htmlFor={`${id}-subject`}>Subject</label>
        <input className={fieldClassName} id={`${id}-subject`} value={subject} onChange={(event) => setSubject(event.target.value)} minLength={5} maxLength={160} required placeholder="What can we help with?" disabled={state === "submitting"} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-semibold" htmlFor={`${id}-category`}>Category</label>
          <select className={fieldClassName} id={`${id}-category`} value={category} onChange={(event) => setCategory(event.target.value)} disabled={state === "submitting"}>
            <option value="booking">Booking</option>
            <option value="payment">Payment or refund</option>
            <option value="property">Property</option>
            <option value="account">Account</option>
            <option value="safety">Safety</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold" htmlFor={`${id}-priority`}>Priority</label>
          <select className={fieldClassName} id={`${id}-priority`} value={priority} onChange={(event) => setPriority(event.target.value)} disabled={state === "submitting"}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-sm font-semibold" htmlFor={`${id}-booking`}>Related booking <span className="font-normal text-[var(--muted)]">(optional)</span></label>
        <select className={fieldClassName} id={`${id}-booking`} value={bookingId} onChange={(event) => setBookingId(event.target.value)} disabled={state === "submitting"}>
          <option value="">No booking selected</option>
          {bookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.label}</option>)}
        </select>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Only bookings available to your signed-in account are listed.</p>
      </div>
      <div>
        <label className="text-sm font-semibold" htmlFor={`${id}-message`}>Describe the issue</label>
        <textarea className={fieldClassName} id={`${id}-message`} value={message} onChange={(event) => setMessage(event.target.value)} rows={6} minLength={1} maxLength={4000} required placeholder="Include relevant dates and what you have already tried. Do not include card numbers, passwords, or government ID numbers." disabled={state === "submitting"} />
        <p className="mt-2 text-xs text-[var(--muted)]">{message.length}/4000 characters</p>
      </div>
      {feedback && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{feedback}</p>}
      <button className="w-full rounded-full bg-[var(--forest)] px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={state === "submitting"}>
        {state === "submitting" ? "Opening case…" : "Open support case"}
      </button>
    </form>
  );
}

export function SupportCaseMessageForm({ caseId, disabled = false, allowInternal = false }: SupportCaseMessageFormProps) {
  const router = useRouter();
  const id = useId();
  const [message, setMessage] = useState("");
  const [internal, setInternal] = useState(false);
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setFeedback(null);
    try {
      const response = await fetch(`/api/v1/support/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "message", message: message.trim(), internal: allowInternal && internal }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Unable to send this message."));
      setMessage("");
      setInternal(false);
      setState("success");
      setFeedback(internal ? "Internal note added." : "Message sent.");
      router.refresh();
    } catch (caught) {
      setState("error");
      setFeedback(caught instanceof Error ? caught.message : "Unable to send this message.");
    }
  }

  return (
    <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
      <div>
        <label className="text-sm font-semibold" htmlFor={`${id}-reply`}>{allowInternal && internal ? "Internal note" : "Reply"}</label>
        <textarea className={fieldClassName} id={`${id}-reply`} value={message} onChange={(event) => setMessage(event.target.value)} rows={4} minLength={1} maxLength={4000} required disabled={disabled || state === "submitting"} placeholder={allowInternal && internal ? "Operational note visible only to administrators" : "Write a message about this case"} />
      </div>
      {allowInternal && <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} disabled={disabled || state === "submitting"} />
        <span>Add as an internal administrator note</span>
      </label>}
      {feedback && <p className={`rounded-xl p-3 text-sm ${state === "error" ? "bg-red-50 text-red-800" : "bg-[var(--sky)] text-[var(--deep)]"}`} role={state === "error" ? "alert" : "status"}>{feedback}</p>}
      <button className="rounded-full bg-[var(--deep)] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={disabled || state === "submitting"}>
        {state === "submitting" ? "Sending…" : internal ? "Add internal note" : "Send reply"}
      </button>
    </form>
  );
}

export function SupportCaseAdminActions({ caseId, status, priority, assignedTo, currentUserId }: SupportCaseAdminActionsProps) {
  const router = useRouter();
  const id = useId();
  const [selectedPriority, setSelectedPriority] = useState(priority);
  const [resolution, setResolution] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "error" | "success">("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const isClosed = status === "resolved" || status === "closed";
  const assignedElsewhere = assignedTo !== null && assignedTo !== currentUserId;

  async function submitAction(body: object, successMessage: string) {
    setState("submitting");
    setFeedback(null);
    try {
      const response = await fetch(`/api/v1/support/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Unable to update this support case."));
      setState("success");
      setFeedback(successMessage);
      router.refresh();
    } catch (caught) {
      setState("error");
      setFeedback(caught instanceof Error ? caught.message : "Unable to update this support case.");
    }
  }

  function handleResolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitAction({ action: "resolve", resolution: resolution.trim() }, "Case resolved and the requester was notified.");
  }

  if (isClosed) {
    return <p className="mt-4 rounded-xl bg-[var(--sand)] p-4 text-sm text-[var(--muted)]">This case is resolved and no longer accepts replies.</p>;
  }

  return (
    <div className="mt-5 space-y-6">
      <div>
        <label className="text-sm font-semibold" htmlFor={`${id}-priority`}>Queue priority</label>
        <select className={fieldClassName} id={`${id}-priority`} value={selectedPriority} onChange={(event) => setSelectedPriority(event.target.value as typeof priority)} disabled={state === "submitting" || assignedElsewhere}>
          <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
        </select>
        <button className="mt-3 rounded-full bg-[var(--deep)] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="button" disabled={state === "submitting" || assignedElsewhere} onClick={() => void submitAction({ action: "assign", priority: selectedPriority }, assignedTo ? "Assignment and priority updated." : "Case assigned to you.")}>
          {state === "submitting" ? "Updating…" : assignedTo ? "Update assignment" : "Assign to me"}
        </button>
        {assignedElsewhere && <p className="mt-2 text-xs text-[var(--muted)]">This case is assigned to another administrator.</p>}
      </div>
      <form onSubmit={handleResolve} noValidate>
        <label className="text-sm font-semibold" htmlFor={`${id}-resolution`}>Resolution summary</label>
        <textarea className={fieldClassName} id={`${id}-resolution`} rows={4} minLength={10} maxLength={2000} required value={resolution} onChange={(event) => setResolution(event.target.value)} disabled={state === "submitting" || assignedElsewhere} placeholder="Summarise the outcome for the requester and audit record." />
        <button className="mt-3 rounded-full bg-[var(--forest)] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={state === "submitting" || assignedElsewhere}>
          Resolve case
        </button>
      </form>
      {feedback && <p className={`rounded-xl p-3 text-sm ${state === "error" ? "bg-red-50 text-red-800" : "bg-[var(--sky)] text-[var(--deep)]"}`} role={state === "error" ? "alert" : "status"}>{feedback}</p>}
    </div>
  );
}
