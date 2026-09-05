"use client";

import { FormEvent, useId, useState } from "react";

type InventoryEditorProps = {
  roomId: string;
  roomName?: string;
  onSaved?: (update: { roomId: string; startDate: string; endDate: string; availableUnits: number; nightlyRate: number }) => void;
};

type FieldErrors = Record<string, string>;

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const body = payload as { message?: unknown; error?: unknown };
    if (typeof body.message === "string") return body.message;
    if (typeof body.error === "string") return body.error;
  }
  return fallback;
}

export default function InventoryEditor({ roomId, roomName, onSaved }: InventoryEditorProps) {
  const formId = useId();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [availableUnits, setAvailableUnits] = useState("1");
  const [nightlyRate, setNightlyRate] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const errorId = (field: string) => `${formId}-${field}-error`;
  const fieldClassName = "mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-[var(--ink)] outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]";

  function validate() {
    const nextErrors: FieldErrors = {};
    if (!roomId) nextErrors.roomId = "Choose a room before updating its inventory.";
    if (!startDate) nextErrors.startDate = "Choose the first date to update.";
    if (!endDate) nextErrors.endDate = "Choose the last date to update.";
    if (startDate && endDate && endDate < startDate) nextErrors.endDate = "End date must be on or after start date.";
    if (!Number.isInteger(Number(availableUnits)) || Number(availableUnits) < 0) nextErrors.availableUnits = "Enter 0 or more available units.";
    if (!Number.isFinite(Number(nightlyRate)) || Number(nightlyRate) < 0) nextErrors.nightlyRate = "Enter a nightly rate of ₹0 or more.";
    return nextErrors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setFormError(null);
    setSuccessMessage(null);
    if (Object.keys(nextErrors).length > 0) return;

    const update = { roomId, startDate, endDate, availableUnits: Number(availableUnits), nightlyRate: Number(nightlyRate) };
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/host/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...update, currencyCode: "INR" }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "We could not save this inventory update. Please try again."));

      setSuccessMessage(startDate === endDate ? `Availability and price saved for ${startDate}.` : `Availability and price saved from ${startDate} to ${endDate}.`);
      onSaved?.(update);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "We could not save this inventory update. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7" aria-labelledby={`${formId}-heading`}>
    <div>
      <p className="eyebrow">Date range update</p>
      <h2 className="serif mt-2 text-3xl" id={`${formId}-heading`}>Set availability and price</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{roomName ? `Update ${roomName}.` : "Update one room."} Changes apply to every night in the selected range.</p>
    </div>
    <form className="mt-6 space-y-5" noValidate onSubmit={handleSubmit}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="text-sm font-semibold" htmlFor={`${formId}-start-date`}>Start date</label>
          <input className={fieldClassName} id={`${formId}-start-date`} type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); if (!endDate || endDate < event.target.value) setEndDate(event.target.value); }} aria-describedby={errors.startDate ? errorId("start-date") : undefined} aria-invalid={Boolean(errors.startDate)} />
          {errors.startDate && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("start-date")}>{errors.startDate}</p>}
        </div>
        <div>
          <label className="text-sm font-semibold" htmlFor={`${formId}-end-date`}>End date</label>
          <input className={fieldClassName} id={`${formId}-end-date`} type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} aria-describedby={errors.endDate ? errorId("end-date") : undefined} aria-invalid={Boolean(errors.endDate)} />
          {errors.endDate && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("end-date")}>{errors.endDate}</p>}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="text-sm font-semibold" htmlFor={`${formId}-available-units`}>Available units</label>
          <input className={fieldClassName} id={`${formId}-available-units`} type="number" min="0" step="1" inputMode="numeric" value={availableUnits} onChange={(event) => setAvailableUnits(event.target.value)} aria-describedby={errors.availableUnits ? errorId("available-units") : undefined} aria-invalid={Boolean(errors.availableUnits)} />
          <p className="mt-1 text-sm text-[var(--muted)]">Set to 0 to make this room unavailable for the night.</p>
          {errors.availableUnits && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("available-units")}>{errors.availableUnits}</p>}
        </div>
        <div>
          <label className="text-sm font-semibold" htmlFor={`${formId}-nightly-rate`}>Nightly price (INR)</label>
          <input className={fieldClassName} id={`${formId}-nightly-rate`} type="number" min="0" step="0.01" inputMode="decimal" value={nightlyRate} onChange={(event) => setNightlyRate(event.target.value)} aria-describedby={errors.nightlyRate ? errorId("nightly-rate") : undefined} aria-invalid={Boolean(errors.nightlyRate)} />
          {errors.nightlyRate && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("nightly-rate")}>{errors.nightlyRate}</p>}
        </div>
      </div>
      {errors.roomId && <p className="rounded-xl bg-[var(--sand)] p-3 text-sm text-[var(--terracotta)]" role="alert">{errors.roomId}</p>}
      {formError && <p className="rounded-xl bg-[var(--sand)] p-3 text-sm text-[var(--terracotta)]" role="alert">{formError}</p>}
      {successMessage && <p className="rounded-xl bg-[var(--sky)] p-3 text-sm text-[var(--forest)]" role="status">{successMessage}</p>}
      <button className="rounded-full bg-[var(--terracotta)] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving update…" : "Save date update"}</button>
    </form>
  </section>;
}
