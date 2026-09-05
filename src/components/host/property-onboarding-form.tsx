"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useId, useState } from "react";

type FieldErrors = Record<string, string>;

type PropertyOnboardingFormProps = {
  destinations: { id: string; name: string; slug: string }[];
  onComplete?: (result: { propertyId: string; roomId: string }) => void;
};

type PropertyResponse = {
  id?: string;
  property?: { id?: string };
  data?: { id?: string; property?: { id?: string } };
  message?: string;
  error?: string;
};

type RoomResponse = {
  id?: string;
  room?: { id?: string };
  data?: { id?: string; room?: { id?: string } };
  message?: string;
  error?: string;
};

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const body = payload as { message?: unknown; error?: unknown };
    if (typeof body.message === "string") return body.message;
    if (typeof body.error === "string") return body.error;
  }
  return fallback;
}

function getPropertyId(payload: PropertyResponse) {
  return payload.id ?? payload.property?.id ?? payload.data?.id ?? payload.data?.property?.id;
}

function getRoomId(payload: RoomResponse) {
  return payload.id ?? payload.room?.id ?? payload.data?.id ?? payload.data?.room?.id;
}

export default function PropertyOnboardingForm({ destinations, onComplete }: PropertyOnboardingFormProps) {
  const router = useRouter();
  const formId = useId();
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? "");
  const [propertyName, setPropertyName] = useState("");
  const [summary, setSummary] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [locality, setLocality] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [maxGuests, setMaxGuests] = useState("1");
  const [roomName, setRoomName] = useState("");
  const [capacityAdults, setCapacityAdults] = useState("1");
  const [bedsDescription, setBedsDescription] = useState("");
  const [baseNightlyRate, setBaseNightlyRate] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validateProperty = () => {
    const nextErrors: FieldErrors = {};
    if (!destinationId) nextErrors.destinationId = "Choose a destination before starting your listing.";
    if (propertyName.trim().length < 2) nextErrors.propertyName = "Enter a property name of at least 2 characters.";
    if (!addressLine1.trim()) nextErrors.addressLine1 = "Enter the property address.";
    if (!locality.trim()) nextErrors.locality = "Enter the town or locality.";
    if (!Number.isInteger(Number(maxGuests)) || Number(maxGuests) < 1) nextErrors.maxGuests = "Enter at least 1 guest.";
    return nextErrors;
  };

  const validateRoom = () => {
    const nextErrors: FieldErrors = {};
    if (roomName.trim().length < 2) nextErrors.roomName = "Enter a room name of at least 2 characters.";
    if (!Number.isInteger(Number(capacityAdults)) || Number(capacityAdults) < 1) nextErrors.capacityAdults = "Enter at least 1 adult guest.";
    if (!bedsDescription.trim()) nextErrors.bedsDescription = "Describe the beds in this room.";
    if (!Number.isFinite(Number(baseNightlyRate)) || Number(baseNightlyRate) < 0) nextErrors.baseNightlyRate = "Enter a nightly rate of ₹0 or more.";
    return nextErrors;
  };

  async function createProperty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateProperty();
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/host/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationId,
          slug: propertyName.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "new-property",
          name: propertyName.trim(),
          summary: summary.trim() || undefined,
          addressLine1: addressLine1.trim(),
          locality: locality.trim(),
          postalCode: postalCode.trim() || undefined,
          maxGuests: Number(maxGuests),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "We could not save your property. Please try again."));

      const id = getPropertyId(payload as PropertyResponse);
      if (!id) throw new Error("Your property was saved, but its identifier was missing. Please refresh before adding a room.");
      setPropertyId(id);
      setErrors({});
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "We could not save your property. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateRoom();
    setErrors(nextErrors);
    setFormError(null);
    if (!propertyId || Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/host/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          name: roomName.trim(),
          capacityAdults: Number(capacityAdults),
          capacityChildren: 0,
          bedsDescription: bedsDescription.trim(),
          baseNightlyRate: Number(baseNightlyRate),
          currencyCode: "INR",
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "We could not save this room. Please try again."));

      const roomId = getRoomId(payload as RoomResponse);
      if (!roomId) throw new Error("Your room was saved, but its identifier was missing. Please refresh before continuing.");
      setErrors({});
      onComplete?.({ propertyId, roomId });
      router.push(`/host/properties?propertyId=${encodeURIComponent(propertyId)}`);
      router.refresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "We could not save this room. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const fieldClassName = "mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-[var(--ink)] outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]";
  const errorId = (field: string) => `${formId}-${field}-error`;

  if (propertyId) {
    return <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7" aria-labelledby={`${formId}-room-heading`}>
      <p className="eyebrow">Step 2 of 2</p>
      <h2 id={`${formId}-room-heading`} className="serif mt-2 text-3xl">Add your first room</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Set the room guests can book first. You can add more rooms later.</p>
      <form className="mt-6 space-y-5" noValidate onSubmit={createRoom}>
        <div>
          <label className="text-sm font-semibold" htmlFor={`${formId}-room-name`}>Room name</label>
          <input className={fieldClassName} id={`${formId}-room-name`} value={roomName} onChange={(event) => setRoomName(event.target.value)} aria-describedby={errors.roomName ? errorId("room-name") : undefined} aria-invalid={Boolean(errors.roomName)} autoComplete="off" />
          {errors.roomName && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("room-name")}>{errors.roomName}</p>}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div><label className="text-sm font-semibold" htmlFor={`${formId}-capacity-adults`}>Adult capacity</label><input className={fieldClassName} id={`${formId}-capacity-adults`} type="number" min="1" step="1" value={capacityAdults} onChange={(event) => setCapacityAdults(event.target.value)} aria-describedby={errors.capacityAdults ? errorId("capacity-adults") : undefined} aria-invalid={Boolean(errors.capacityAdults)} />{errors.capacityAdults && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("capacity-adults")}>{errors.capacityAdults}</p>}</div>
          <div><label className="text-sm font-semibold" htmlFor={`${formId}-nightly-rate`}>Nightly rate (INR)</label><input className={fieldClassName} id={`${formId}-nightly-rate`} type="number" min="0" step="0.01" inputMode="decimal" value={baseNightlyRate} onChange={(event) => setBaseNightlyRate(event.target.value)} aria-describedby={errors.baseNightlyRate ? errorId("nightly-rate") : undefined} aria-invalid={Boolean(errors.baseNightlyRate)} />{errors.baseNightlyRate && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("nightly-rate")}>{errors.baseNightlyRate}</p>}</div>
        </div>
        <div><label className="text-sm font-semibold" htmlFor={`${formId}-beds`}>Bed arrangement</label><input className={fieldClassName} id={`${formId}-beds`} value={bedsDescription} onChange={(event) => setBedsDescription(event.target.value)} placeholder="For example, 1 queen bed" aria-describedby={errors.bedsDescription ? errorId("beds") : undefined} aria-invalid={Boolean(errors.bedsDescription)} />{errors.bedsDescription && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("beds")}>{errors.bedsDescription}</p>}</div>
        {formError && <p className="rounded-xl bg-[var(--sand)] p-3 text-sm text-[var(--terracotta)]" role="alert">{formError}</p>}
        <button className="rounded-full bg-[var(--terracotta)] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving room…" : "Save room and continue"}</button>
      </form>
    </section>;
  }

  return <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7" aria-labelledby={`${formId}-property-heading`}>
    <p className="eyebrow">Step 1 of 2</p>
    <h2 id={`${formId}-property-heading`} className="serif mt-2 text-3xl">Tell us about your place</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Start with the guest-facing essentials. Payout information and verification documents are collected separately when needed.</p>
    <form className="mt-6 space-y-5" noValidate onSubmit={createProperty}>
      <div>
        <label className="text-sm font-semibold" htmlFor={`${formId}-destination`}>Destination</label>
        <select className={fieldClassName} id={`${formId}-destination`} value={destinationId} onChange={(event) => setDestinationId(event.target.value)} aria-describedby={errors.destinationId ? errorId("destination") : undefined} aria-invalid={Boolean(errors.destinationId)}>
          {destinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.name}</option>)}
        </select>
        {errors.destinationId && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("destination")}>{errors.destinationId}</p>}
      </div>
      <div><label className="text-sm font-semibold" htmlFor={`${formId}-property-name`}>Property name</label><input className={fieldClassName} id={`${formId}-property-name`} value={propertyName} onChange={(event) => setPropertyName(event.target.value)} aria-describedby={errors.propertyName ? errorId("property-name") : undefined} aria-invalid={Boolean(errors.propertyName)} autoComplete="organization" />{errors.propertyName && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("property-name")}>{errors.propertyName}</p>}</div>
      <div><label className="text-sm font-semibold" htmlFor={`${formId}-summary`}>Short summary <span className="font-normal text-[var(--muted)]">(optional)</span></label><textarea className={fieldClassName} id={`${formId}-summary`} value={summary} maxLength={500} rows={3} onChange={(event) => setSummary(event.target.value)} placeholder="A family-run homestay with breakfast, local guidance, and clear arrival details." /></div>
      <div><label className="text-sm font-semibold" htmlFor={`${formId}-address`}>Property address</label><input className={fieldClassName} id={`${formId}-address`} value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} aria-describedby={errors.addressLine1 ? errorId("address") : undefined} aria-invalid={Boolean(errors.addressLine1)} autoComplete="street-address" />{errors.addressLine1 && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("address")}>{errors.addressLine1}</p>}</div>
      <div className="grid gap-5 sm:grid-cols-2"><div><label className="text-sm font-semibold" htmlFor={`${formId}-locality`}>Town or locality</label><input className={fieldClassName} id={`${formId}-locality`} value={locality} onChange={(event) => setLocality(event.target.value)} aria-describedby={errors.locality ? errorId("locality") : undefined} aria-invalid={Boolean(errors.locality)} autoComplete="address-level2" />{errors.locality && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("locality")}>{errors.locality}</p>}</div><div><label className="text-sm font-semibold" htmlFor={`${formId}-postal-code`}>Postal code <span className="font-normal text-[var(--muted)]">(optional)</span></label><input className={fieldClassName} id={`${formId}-postal-code`} value={postalCode} onChange={(event) => setPostalCode(event.target.value)} autoComplete="postal-code" /></div></div>
      <div><label className="text-sm font-semibold" htmlFor={`${formId}-max-guests`}>Maximum guests</label><input className={`${fieldClassName} max-w-44`} id={`${formId}-max-guests`} type="number" min="1" step="1" value={maxGuests} onChange={(event) => setMaxGuests(event.target.value)} aria-describedby={errors.maxGuests ? errorId("max-guests") : undefined} aria-invalid={Boolean(errors.maxGuests)} />{errors.maxGuests && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("max-guests")}>{errors.maxGuests}</p>}</div>
      {formError && <p className="rounded-xl bg-[var(--sand)] p-3 text-sm text-[var(--terracotta)]" role="alert">{formError}</p>}
      <button className="rounded-full bg-[var(--terracotta)] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving property…" : "Save property and add a room"}</button>
    </form>
  </section>;
}
