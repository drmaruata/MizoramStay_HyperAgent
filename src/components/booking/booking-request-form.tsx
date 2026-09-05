"use client";

import type { FormEvent } from "react";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { bookingHoldSchema } from "@/lib/validation/booking";
import { bookingIdSchema } from "@/lib/validation/phase3-booking";

type BookableRoom = {
  id: string;
  name: string;
  capacityAdults: number;
  capacityChildren: number;
  baseNightlyRate: number;
  currencyCode: string;
};

type BookingRequestFormProps = {
  propertyId: string;
  propertySlug: string;
  propertyMaxGuests: number;
  rooms: BookableRoom[];
};

type SubmissionState = "idle" | "submitting" | "error" | "unauthenticated";

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateNumber(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? Date.UTC(year, month - 1, day) : Number.NaN;
}

function numberOfNights(checkIn: string, checkOut: string) {
  const difference = dateNumber(checkOut) - dateNumber(checkIn);
  return Number.isFinite(difference) && difference > 0 ? difference / 86_400_000 : 0;
}

function formatRate(amount: number, currencyCode: string) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toLocaleString("en-IN")}`;
  }
}

function responseError(payload: unknown, fallback: string) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : fallback;
}

function responseBookingId(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("hold" in payload)) return null;
  const hold = Array.isArray(payload.hold) ? payload.hold[0] : payload.hold;
  if (!hold || typeof hold !== "object" || !("id" in hold)) return null;
  const parsed = bookingIdSchema.safeParse(hold.id);
  return parsed.success ? parsed.data : null;
}

export function BookingRequestForm({
  propertyId,
  propertySlug,
  propertyMaxGuests,
  rooms,
}: BookingRequestFormProps) {
  const router = useRouter();
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState(1);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [submissionState, setSubmissionState] = useState<SubmissionState>("idle");
  const [message, setMessage] = useState("");
  const previousRequest = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  const selectedRoom = rooms.find((room) => room.id === roomId) ?? null;
  const roomCapacity = selectedRoom
    ? selectedRoom.capacityAdults + selectedRoom.capacityChildren
    : propertyMaxGuests;
  const maximumGuests = Math.max(1, Math.min(20, propertyMaxGuests, roomCapacity));
  const nights = numberOfNights(checkIn, checkOut);
  const estimatedRoomRate = selectedRoom && nights > 0 ? selectedRoom.baseNightlyRate * nights : null;
  const today = localDateString(new Date());
  const loginHref = `/login?next=${encodeURIComponent(`/stays/${propertySlug}#booking-request`)}`;

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionState === "submitting") return;

    setMessage("");
    setSubmissionState("submitting");

    const trimmedPhone = contactPhone.trim();
    const requestWithoutKey = {
      propertyId,
      roomId,
      contactName: contactName.trim(),
      contactEmail: contactEmail.trim(),
      ...(trimmedPhone ? { contactPhone: trimmedPhone } : {}),
      checkIn,
      checkOut,
      guests,
    };
    const fingerprint = JSON.stringify(requestWithoutKey);
    const idempotencyKey = previousRequest.current?.fingerprint === fingerprint
      ? previousRequest.current.idempotencyKey
      : crypto.randomUUID();
    previousRequest.current = { fingerprint, idempotencyKey };

    const parsed = bookingHoldSchema.safeParse({ ...requestWithoutKey, idempotencyKey });
    if (!parsed.success || !rooms.some((room) => room.id === roomId) || guests > maximumGuests) {
      const validationMessage = parsed.success
        ? "Choose a valid room and guest count."
        : parsed.error.issues[0]?.message ?? "Check the booking details and try again.";
      setSubmissionState("error");
      setMessage(validationMessage);
      return;
    }

    try {
      const response = await fetch("/api/v1/booking-holds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...requestWithoutKey,
          checkIn: parsed.data.checkIn.toISOString().slice(0, 10),
          checkOut: parsed.data.checkOut.toISOString().slice(0, 10),
          idempotencyKey,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (response.status === 401) {
        setSubmissionState("unauthenticated");
        setMessage("Sign in to place this temporary reservation hold.");
        return;
      }
      if (!response.ok) {
        setSubmissionState("error");
        setMessage(responseError(payload, "This room could not be held. Check your dates and try again."));
        return;
      }

      const bookingId = responseBookingId(payload);
      if (!bookingId) {
        setSubmissionState("error");
        setMessage("The reservation was received, but its booking reference was unavailable. Please try again.");
        return;
      }

      router.push(`/booking/${bookingId}`);
    } catch {
      setSubmissionState("error");
      setMessage("We could not reach the reservation service. Try again with the same details.");
    }
  }

  if (rooms.length === 0) {
    return (
      <div className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--sand)] p-4 text-sm leading-6 text-[var(--muted)]">
        No active rooms are available to request right now.
      </div>
    );
  }

  const fieldClassName = "mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]";

  return (
    <form className="mt-5 space-y-4" id="booking-request" onSubmit={submitRequest} aria-describedby="booking-estimate-note">
      <div>
        <label className="text-sm font-semibold" htmlFor="booking-room">Room</label>
        <select
          className={fieldClassName}
          id="booking-room"
          name="roomId"
          required
          value={roomId}
          onChange={(event) => {
            setRoomId(event.target.value);
            setGuests(1);
          }}
        >
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name} · sleeps {room.capacityAdults + room.capacityChildren}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold">Stay dates</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]" htmlFor="booking-check-in">Check-in</label>
            <input
              className={fieldClassName}
              id="booking-check-in"
              name="checkIn"
              type="date"
              min={today}
              required
              value={checkIn}
              onChange={(event) => setCheckIn(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]" htmlFor="booking-check-out">Check-out</label>
            <input
              className={fieldClassName}
              id="booking-check-out"
              name="checkOut"
              type="date"
              min={checkIn || today}
              required
              value={checkOut}
              onChange={(event) => setCheckOut(event.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <div>
        <label className="text-sm font-semibold" htmlFor="booking-guests">Guests</label>
        <input
          className={fieldClassName}
          id="booking-guests"
          name="guests"
          type="number"
          inputMode="numeric"
          min={1}
          max={maximumGuests}
          required
          value={guests}
          onChange={(event) => setGuests(event.target.valueAsNumber || 1)}
        />
        <p className="mt-1 text-xs text-[var(--muted)]">Up to {maximumGuests} {maximumGuests === 1 ? "guest" : "guests"} in this room.</p>
      </div>

      <fieldset className="border-t border-[var(--line)] pt-4">
        <legend className="text-sm font-semibold">Contact details</legend>
        <div className="mt-1.5 space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]" htmlFor="booking-contact-name">Full name</label>
            <input
              className={fieldClassName}
              id="booking-contact-name"
              name="contactName"
              type="text"
              autoComplete="name"
              maxLength={120}
              required
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]" htmlFor="booking-contact-email">Email</label>
            <input
              className={fieldClassName}
              id="booking-contact-email"
              name="contactEmail"
              type="email"
              autoComplete="email"
              required
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]" htmlFor="booking-contact-phone">Phone <span className="font-normal normal-case">(optional)</span></label>
            <input
              className={fieldClassName}
              id="booking-contact-phone"
              name="contactPhone"
              type="tel"
              autoComplete="tel"
              minLength={6}
              maxLength={30}
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <div className="rounded-xl bg-[var(--sand)] p-4">
        <p className="text-sm font-semibold">Estimated room rate</p>
        <p className="mt-1 text-lg font-semibold">
          {estimatedRoomRate && selectedRoom
            ? `${formatRate(estimatedRoomRate, selectedRoom.currencyCode)} for ${nights} ${nights === 1 ? "night" : "nights"}`
            : selectedRoom
              ? `${formatRate(selectedRoom.baseNightlyRate, selectedRoom.currencyCode)} per night`
              : "Select a room and dates"}
        </p>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]" id="booking-estimate-note">
          This estimate uses the advertised base room rate. The database calculates and records the final total from live nightly rates; no client-calculated price is submitted.
        </p>
      </div>

      {message && (
        <div className={`rounded-xl p-3 text-sm leading-6 ${submissionState === "unauthenticated" ? "bg-[var(--sky)] text-[var(--deep)]" : "bg-red-50 text-red-800"}`} role="alert">
          <p>{message}</p>
          {submissionState === "unauthenticated" && (
            <Link className="mt-2 inline-block font-semibold underline underline-offset-4" href={loginHref}>Sign in to continue</Link>
          )}
        </div>
      )}

      <button
        className="w-full rounded-full bg-[var(--deep)] px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        type="submit"
        disabled={submissionState === "submitting"}
      >
        {submissionState === "submitting" ? "Requesting hold…" : "Request to reserve"}
      </button>
      <p className="text-center text-xs leading-5 text-[var(--muted)]">
        This requests a temporary hold only. No payment details are collected on this form. You will see the full price and cancellation terms before payment.
      </p>
    </form>
  );
}

export default BookingRequestForm;
