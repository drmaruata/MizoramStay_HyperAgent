"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useId, useState } from "react";

type HostPropertyOption = {
  id: string;
  name: string;
};

type RoomCreateFormProps = {
  properties: HostPropertyOption[];
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

export default function RoomCreateForm({ properties }: RoomCreateFormProps) {
  const router = useRouter();
  const formId = useId();
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capacityAdults, setCapacityAdults] = useState("1");
  const [capacityChildren, setCapacityChildren] = useState("0");
  const [bedsDescription, setBedsDescription] = useState("");
  const [baseNightlyRate, setBaseNightlyRate] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fieldClassName = "mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-[var(--ink)] outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]";
  const errorId = (field: string) => `${formId}-${field}-error`;

  function validate() {
    const nextErrors: FieldErrors = {};
    if (!propertyId) nextErrors.propertyId = "Choose a property for this room.";
    if (name.trim().length < 1) nextErrors.name = "Enter a room name.";
    if (!Number.isInteger(Number(capacityAdults)) || Number(capacityAdults) < 1) nextErrors.capacityAdults = "Enter at least 1 adult guest.";
    if (!Number.isInteger(Number(capacityChildren)) || Number(capacityChildren) < 0) nextErrors.capacityChildren = "Enter 0 or more child guests.";
    if (!Number.isFinite(Number(baseNightlyRate)) || Number(baseNightlyRate) < 0) nextErrors.baseNightlyRate = "Enter a nightly rate of INR 0 or more.";
    return nextErrors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setFormError(null);
    setSuccessMessage(null);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/host/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          name: name.trim(),
          description: description.trim() || undefined,
          capacityAdults: Number(capacityAdults),
          capacityChildren: Number(capacityChildren),
          bedsDescription: bedsDescription.trim() || undefined,
          baseNightlyRate: Number(baseNightlyRate),
          currencyCode: "INR",
          isActive: true,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Unable to create this room."));

      setName("");
      setDescription("");
      setCapacityAdults("1");
      setCapacityChildren("0");
      setBedsDescription("");
      setBaseNightlyRate("");
      setSuccessMessage("Room created. Add availability next so guests can find it in search.");
      router.refresh();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Unable to create this room.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7" aria-labelledby={`${formId}-heading`}>
      <p className="eyebrow">Add room</p>
      <h2 className="serif mt-2 text-3xl" id={`${formId}-heading`}>Create a bookable room</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Rooms define capacity and base pricing. Date-specific availability is managed after the room exists.</p>
      <form className="mt-6 space-y-5" noValidate onSubmit={handleSubmit}>
        <div>
          <label className="text-sm font-semibold" htmlFor={`${formId}-property`}>Property</label>
          <select className={fieldClassName} id={`${formId}-property`} value={propertyId} onChange={(event) => setPropertyId(event.target.value)} aria-describedby={errors.propertyId ? errorId("property") : undefined} aria-invalid={Boolean(errors.propertyId)}>
            {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
          </select>
          {errors.propertyId && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("property")}>{errors.propertyId}</p>}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div><label className="text-sm font-semibold" htmlFor={`${formId}-name`}>Room name</label><input className={fieldClassName} id={`${formId}-name`} value={name} maxLength={180} onChange={(event) => setName(event.target.value)} aria-describedby={errors.name ? errorId("name") : undefined} aria-invalid={Boolean(errors.name)} />{errors.name && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("name")}>{errors.name}</p>}</div>
          <div><label className="text-sm font-semibold" htmlFor={`${formId}-rate`}>Base nightly rate</label><input className={fieldClassName} id={`${formId}-rate`} type="number" min="0" step="0.01" inputMode="decimal" value={baseNightlyRate} onChange={(event) => setBaseNightlyRate(event.target.value)} aria-describedby={errors.baseNightlyRate ? errorId("rate") : undefined} aria-invalid={Boolean(errors.baseNightlyRate)} />{errors.baseNightlyRate && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("rate")}>{errors.baseNightlyRate}</p>}</div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div><label className="text-sm font-semibold" htmlFor={`${formId}-adults`}>Adult capacity</label><input className={fieldClassName} id={`${formId}-adults`} type="number" min="1" step="1" value={capacityAdults} onChange={(event) => setCapacityAdults(event.target.value)} aria-describedby={errors.capacityAdults ? errorId("adults") : undefined} aria-invalid={Boolean(errors.capacityAdults)} />{errors.capacityAdults && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("adults")}>{errors.capacityAdults}</p>}</div>
          <div><label className="text-sm font-semibold" htmlFor={`${formId}-children`}>Child capacity</label><input className={fieldClassName} id={`${formId}-children`} type="number" min="0" step="1" value={capacityChildren} onChange={(event) => setCapacityChildren(event.target.value)} aria-describedby={errors.capacityChildren ? errorId("children") : undefined} aria-invalid={Boolean(errors.capacityChildren)} />{errors.capacityChildren && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("children")}>{errors.capacityChildren}</p>}</div>
        </div>
        <div><label className="text-sm font-semibold" htmlFor={`${formId}-beds`}>Bed arrangement <span className="font-normal text-[var(--muted)]">(optional)</span></label><input className={fieldClassName} id={`${formId}-beds`} value={bedsDescription} maxLength={500} onChange={(event) => setBedsDescription(event.target.value)} placeholder="For example, 1 queen bed and 1 floor mattress" /></div>
        <div><label className="text-sm font-semibold" htmlFor={`${formId}-description`}>Room description <span className="font-normal text-[var(--muted)]">(optional)</span></label><textarea className={fieldClassName} id={`${formId}-description`} value={description} maxLength={10_000} rows={4} onChange={(event) => setDescription(event.target.value)} /></div>
        {formError && <p className="rounded-xl bg-[var(--sand)] p-3 text-sm text-[var(--terracotta)]" role="alert">{formError}</p>}
        {successMessage && <p className="rounded-xl bg-[var(--sky)] p-3 text-sm text-[var(--forest)]" role="status">{successMessage}</p>}
        <button className="rounded-full bg-[var(--terracotta)] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating room..." : "Create room"}</button>
      </form>
    </section>
  );
}
