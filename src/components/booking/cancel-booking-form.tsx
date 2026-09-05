"use client";

import { FormEvent, useId, useState } from "react";
import { useRouter } from "next/navigation";

type CancelBookingFormProps = {
  bookingId: string;
  bookingStatus: "hold" | "confirmed";
};

type CancellationResult = {
  refundable_amount?: number | string;
  currency_code?: string;
};

function formatRefund(value: number | string, currencyCode: string) {
  const amount = Number(value);
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currencyCode }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toLocaleString("en-IN")}`;
  }
}

function getErrorMessage(payload: unknown, fallback: string) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : fallback;
}

export function CancelBookingForm({ bookingId, bookingStatus }: CancelBookingFormProps) {
  const id = useId();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanReason = reason.trim();
    if (cleanReason.length < 10) {
      setStatus("error");
      setMessage("Please provide at least 10 characters so we can understand the cancellation.");
      return;
    }
    if (!acknowledged) {
      setStatus("error");
      setMessage("Please acknowledge that cancellation is final before continuing.");
      return;
    }

    setStatus("submitting");
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/bookings/${encodeURIComponent(bookingId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cleanReason }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Unable to cancel this booking."));

      const cancellation = payload && typeof payload === "object" && "cancellation" in payload
        ? payload.cancellation as CancellationResult
        : null;
      const refundableAmount = Number(cancellation?.refundable_amount ?? 0);
      const refundMessage = refundableAmount > 0 && cancellation?.currency_code
        ? ` A full refund of ${formatRefund(refundableAmount, cancellation.currency_code)} has been requested to the original payment method.`
        : " No captured payment required a refund.";

      setStatus("success");
      setMessage(bookingStatus === "hold"
        ? "Booking hold cancelled and the room was released. No captured payment required a refund."
        : `Booking cancelled.${refundMessage}`);
      router.refresh();
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof Error ? caught.message : "Unable to cancel this booking.");
    }
  }

  return (
    <form className="mt-5 space-y-4" onSubmit={handleSubmit} noValidate>
      <div>
        <label className="text-sm font-semibold" htmlFor={`${id}-reason`}>Reason for cancellation</label>
        <textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={4}
          minLength={10}
          maxLength={500}
          required
          disabled={status === "submitting" || status === "success"}
          aria-describedby={`${id}-reason-help`}
          className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-3 outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)] disabled:opacity-60"
          placeholder="Tell us briefly why your plans changed"
        />
        <p className="mt-1 text-xs text-[var(--muted)]" id={`${id}-reason-help`}>{reason.length}/500 characters</p>
      </div>
      <label className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--sand)] p-3 text-sm leading-6">
        <input
          className="mt-1"
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          disabled={status === "submitting" || status === "success"}
        />
        <span>I understand this cancellation is final and the room may be released immediately.</span>
      </label>
      {message && (
        <p className={`rounded-xl p-3 text-sm leading-6 ${status === "error" ? "bg-red-50 text-red-800" : "bg-[var(--sky)] text-[var(--deep)]"}`} role={status === "error" ? "alert" : "status"}>
          {message}
        </p>
      )}
      <button
        type="submit"
        disabled={status === "submitting" || status === "success"}
        className="rounded-full border border-[var(--terracotta)] px-5 py-2.5 text-sm font-semibold text-[var(--terracotta)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "submitting" ? "Cancelling…" : status === "success" ? "Booking cancelled" : "Cancel booking"}
      </button>
    </form>
  );
}

export default CancelBookingForm;
