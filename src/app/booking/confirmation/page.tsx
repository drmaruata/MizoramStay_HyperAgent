import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bookingIdSchema } from "@/lib/validation/phase3-booking";

type Props = {
  searchParams: Promise<{ bookingId?: string | string[] }>;
};

type ConfirmedBooking = {
  id: string;
  check_in: string;
  check_out: string;
  guest_count: number;
  currency_code: string;
  subtotal: number | string;
  taxes: number | string;
  total_amount: number | string;
  properties: {
    name: string;
    locality: string | null;
    check_in_time: string;
    destinations: { name: string; state: string } | { name: string; state: string }[] | null;
  } | {
    name: string;
    locality: string | null;
    check_in_time: string;
    destinations: { name: string; state: string } | { name: string; state: string }[] | null;
  }[] | null;
  booking_items: { id: string; quantity: number; nights: number }[];
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Booking confirmation",
  description: "Check the verified status of your MizoramStay booking.",
};

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatTime(value: string) {
  const [hour = "0", minute = "0"] = value.split(":");
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2020, 0, 1, Number(hour), Number(minute))));
}

function formatMoney(value: number | string, currencyCode: string) {
  const amount = Number(value);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${currencyCode} ${Number.isFinite(amount) ? amount.toLocaleString("en-IN") : value}`;
  }
}

function ConfirmationShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
          <Link className="brand-mark text-xl font-bold" href="/">mizoram<span>stay</span></Link>
          <Link className="text-sm font-semibold underline underline-offset-4" href="/account">My trips</Link>
        </div>
      </header>
      <section className="mx-auto max-w-5xl px-5 pb-20 pt-8 sm:px-8 lg:px-10">{children}</section>
    </main>
  );
}

function BookingState({ title, message, kind = "pending" }: { title: string; message: string; kind?: "pending" | "missing" | "error" }) {
  const eyebrow = kind === "pending" ? "Confirmation pending" : kind === "missing" ? "Booking not found" : "Unable to verify";
  return (
    <ConfirmationShell>
      <div className="rounded-3xl border border-[var(--line)] bg-white p-7 sm:p-10" role={kind === "error" ? "alert" : undefined}>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="serif mt-3 text-4xl leading-tight sm:text-5xl">{title}</h1>
        <p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">{message}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link className="rounded-full bg-[var(--deep)] px-5 py-3 text-sm font-semibold text-white" href="/account">View my trips</Link>
          <Link className="rounded-full border border-[var(--ink)] px-5 py-3 text-sm font-semibold" href="/stays">Explore stays</Link>
        </div>
      </div>
    </ConfirmationShell>
  );
}

export default async function BookingConfirmationPage({ searchParams }: Props) {
  const rawBookingId = (await searchParams).bookingId;
  const returnPath = typeof rawBookingId === "string"
    ? `/booking/confirmation?bookingId=${encodeURIComponent(rawBookingId)}`
    : "/booking/confirmation";
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect(`/login?next=${encodeURIComponent(returnPath)}`);

  if (rawBookingId === undefined) {
    return <BookingState title="We are waiting for a booking reference." message="A payment return does not confirm a reservation by itself. Open the booking from My trips to check its live status." />;
  }

  const parsedBookingId = bookingIdSchema.safeParse(rawBookingId);
  if (!parsedBookingId.success) {
    return <BookingState kind="missing" title="This booking reference is not valid." message="No confirmed reservation can be shown for this link. Check the address or open the booking from My trips." />;
  }

  // Confirmation is based only on the authenticated user's server-side booking status.
  // Query-string payment flags are deliberately ignored.
  const { data, error } = await supabase
    .from("bookings")
    .select(`
      id,
      check_in,
      check_out,
      guest_count,
      currency_code,
      subtotal,
      taxes,
      total_amount,
      properties:property_id (
        name,
        locality,
        check_in_time,
        destinations:destination_id (name, state)
      ),
      booking_items (id, quantity, nights)
    `)
    .eq("id", parsedBookingId.data)
    .eq("guest_id", user.id)
    .eq("status", "confirmed")
    .maybeSingle();

  if (error) {
    return <BookingState kind="error" title="We could not verify this booking." message="Your reservation status is temporarily unavailable. Please try again from My trips; do not rely on a payment-return message alone." />;
  }
  if (!data) {
    return <BookingState kind="missing" title="No confirmed booking was found." message="The booking may still be awaiting verified payment, may belong to another account, or may no longer be confirmed. My trips shows the current status." />;
  }

  const booking = data as unknown as ConfirmedBooking;
  const property = one(booking.properties);
  if (!property) {
    return <BookingState kind="error" title="We could not load the stay details." message="The booking is confirmed, but its property details are temporarily unavailable. Open My trips and try again shortly." />;
  }

  const destination = one(property.destinations);
  const nights = Math.max(0, Math.round((Date.parse(`${booking.check_out}T00:00:00Z`) - Date.parse(`${booking.check_in}T00:00:00Z`)) / 86_400_000));
  const roomCount = booking.booking_items.reduce((total, item) => total + item.quantity, 0);
  const subtotal = Number(booking.subtotal);
  const taxes = Number(booking.taxes);
  const total = Number(booking.total_amount);
  const otherFees = Math.max(0, total - subtotal - taxes);
  const location = [property.locality, destination?.name, destination?.state].filter(Boolean).join(", ");

  return (
    <ConfirmationShell>
      <div className="rounded-3xl bg-[var(--deep)] px-6 py-10 text-white sm:px-10">
        <p className="eyebrow !text-[var(--gold)]">Verified reservation</p>
        <div className="mt-4 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <h1 className="serif text-4xl leading-tight sm:text-5xl">Your stay is confirmed.</h1>
            <p className="mt-3 max-w-xl leading-7 text-white/75">This confirmation comes from the current booking status in your signed-in account. Keep the booking reference handy for arrival.</p>
          </div>
          <p className="shrink-0 rounded-full border border-white/25 px-4 py-2 text-sm font-semibold">Booking {booking.id.slice(0, 8).toUpperCase()}</p>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
        <section aria-labelledby="stay-details" className="rounded-3xl border border-[var(--line)] bg-white p-6 sm:p-8">
          <p className="eyebrow">Your stay</p>
          <h2 id="stay-details" className="mt-2 text-3xl font-semibold">{property.name}</h2>
          <p className="mt-2 text-[var(--muted)]">{location || "Location details unavailable"}</p>
          <dl className="mt-7 grid gap-5 border-y border-[var(--line)] py-6 sm:grid-cols-3">
            <div><dt className="text-xs font-bold uppercase tracking-[.12em] text-[var(--muted)]">Dates</dt><dd className="mt-2 font-semibold">{formatDate(booking.check_in)}–{formatDate(booking.check_out)}</dd><dd className="mt-1 text-sm text-[var(--muted)]">{nights} {nights === 1 ? "night" : "nights"}</dd></div>
            <div><dt className="text-xs font-bold uppercase tracking-[.12em] text-[var(--muted)]">Guests</dt><dd className="mt-2 font-semibold">{booking.guest_count} {booking.guest_count === 1 ? "guest" : "guests"} · {roomCount} {roomCount === 1 ? "room" : "rooms"}</dd><dd className="mt-1 text-sm text-[var(--muted)]">Check in after {formatTime(property.check_in_time)}</dd></div>
            <div><dt className="text-xs font-bold uppercase tracking-[.12em] text-[var(--muted)]">Booking ID</dt><dd className="mt-2 break-all font-mono text-sm font-semibold">{booking.id}</dd><dd className="mt-1 text-sm text-[var(--muted)]">Show at check-in</dd></div>
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link className="rounded-full bg-[var(--deep)] px-5 py-3 text-sm font-semibold text-white" href={`/booking/${booking.id}`}>View trip details</Link>
            <Link className="rounded-full border border-[var(--ink)] px-5 py-3 text-sm font-semibold" href="/travel-guides">Plan your journey</Link>
          </div>
        </section>

        <aside className="rounded-3xl border border-[var(--line)] bg-[var(--sand)] p-6 sm:p-8">
          <h2 className="text-xl font-semibold">Price summary</h2>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-4"><dt>Stay · {nights} {nights === 1 ? "night" : "nights"}</dt><dd>{formatMoney(booking.subtotal, booking.currency_code)}</dd></div>
            <div className="flex justify-between gap-4"><dt>Taxes</dt><dd>{formatMoney(booking.taxes, booking.currency_code)}</dd></div>
            {otherFees > 0.009 && <div className="flex justify-between gap-4"><dt>Other fees</dt><dd>{formatMoney(otherFees, booking.currency_code)}</dd></div>}
            <div className="flex justify-between gap-4 border-t border-[var(--line)] pt-4 text-base font-bold"><dt>Booking total</dt><dd>{formatMoney(booking.total_amount, booking.currency_code)}</dd></div>
          </dl>
          <p className="mt-6 text-sm leading-6 text-[var(--muted)]">Review arrival guidance, payment records, and cancellation terms in your trip details.</p>
        </aside>
      </div>

      <section aria-labelledby="next-steps" className="mt-8 rounded-3xl border border-[var(--line)] bg-white p-6 sm:p-8">
        <p className="eyebrow">Before you go</p><h2 id="next-steps" className="mt-2 text-2xl font-semibold">A few useful next steps</h2>
        <div className="mt-6 grid gap-5 md:grid-cols-3"><div><p className="font-semibold">Review your booking</p><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Your itinerary and live payment status are available in trip details.</p></div><div><p className="font-semibold">Check arrival details</p><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Use trip details for the latest check-in information and booking reference.</p></div><div><p className="font-semibold">Travel thoughtfully</p><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Read local planning notes and pack for changing hill weather.</p></div></div>
      </section>
    </ConfirmationShell>
  );
}
