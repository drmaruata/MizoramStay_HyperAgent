import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { createClient } from "@/lib/supabase/server";

type PropertySummary = {
  id: string;
  name: string;
};

type HostBooking = {
  id: string;
  status: "hold" | "confirmed" | "cancelled" | "expired" | "completed";
  check_in: string;
  check_out: string;
  guest_count: number;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  total_amount: number | string;
  currency_code: string;
  properties: PropertySummary | PropertySummary[] | null;
};

const statusPresentation: Record<HostBooking["status"], { label: string; className: string }> = {
  hold: { label: "Held for payment", className: "bg-[var(--gold)] text-[var(--deep)]" },
  confirmed: { label: "Confirmed", className: "bg-[var(--sky)] text-[var(--deep)]" },
  cancelled: { label: "Cancelled", className: "bg-red-50 text-red-800" },
  expired: { label: "Hold expired", className: "bg-[var(--sand)] text-[var(--muted)]" },
  completed: { label: "Completed", className: "bg-[var(--sand)] text-[var(--deep)]" },
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Host bookings",
  description: "View reservations for properties you host on MizoramStay.",
};

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatMoney(value: number | string, currencyCode: string) {
  const amount = Number(value);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode} ${Number.isFinite(amount) ? amount.toLocaleString("en-IN") : value}`;
  }
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function nightsBetween(checkIn: string, checkOut: string) {
  const milliseconds = Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`);
  return Math.max(0, Math.round(milliseconds / 86_400_000));
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" className="brand-mark text-lg font-bold">mizoram<span>stay</span></Link>
          <Link href="/host/dashboard" className="text-sm font-semibold">Host dashboard</Link>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-5 py-9 sm:py-12">
        <p className="eyebrow">Guest stays</p>
        <h1 className="serif mt-2 text-4xl sm:text-5xl">Bookings</h1>
        <p className="mt-3 text-[var(--muted)]">Reservations across the properties you host.</p>
        {children}
      </section>
    </main>
  );
}

function LoadError() {
  return (
    <PageShell>
      <div className="mt-8 rounded-2xl border border-red-200 bg-white p-6" role="alert">
        <h2 className="text-lg font-semibold">Bookings could not be loaded</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">We could not retrieve your reservations right now. Please refresh the page or try again later.</p>
      </div>
    </PageShell>
  );
}

export default async function HostBookingsPage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return <LoadError />;
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) return <LoadError />;
  if (!user) redirect(`/login?next=${encodeURIComponent("/host/bookings")}`);

  // Use the authenticated publishable-key client throughout so RLS remains authoritative.
  const { data: properties, error: propertiesError } = await supabase
    .from("properties")
    .select("id")
    .eq("host_id", user.id);

  if (propertiesError) return <LoadError />;

  const propertyIds = properties.map((property) => property.id);
  let bookings: HostBooking[] = [];

  if (propertyIds.length > 0) {
    const { data, error } = await supabase
      .from("bookings")
      .select(`
        id,
        status,
        check_in,
        check_out,
        guest_count,
        contact_name,
        contact_email,
        contact_phone,
        total_amount,
        currency_code,
        properties:property_id (id, name)
      `)
      .in("property_id", propertyIds)
      .order("check_in", { ascending: true });

    if (error) return <LoadError />;
    bookings = (data ?? []) as unknown as HostBooking[];
  }

  return (
    <PageShell>
      <RealtimeRefresh
        channelName="host-bookings"
        subscriptions={propertyIds.map((propertyId) => ({
          table: "bookings" as const,
          filter: `property_id=eq.${propertyId}`,
        }))}
      />
      {bookings.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-[var(--line)] bg-white p-6">
          <h2 className="text-lg font-semibold">No bookings yet</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            Reservations for your properties will appear here when guests book.
          </p>
          {propertyIds.length === 0 && (
            <Link className="mt-5 inline-block text-sm font-semibold underline underline-offset-4" href="/host/properties">
              Add or review your properties
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {bookings.map((booking) => {
            const property = one(booking.properties);
            const status = statusPresentation[booking.status];
            const nights = nightsBetween(booking.check_in, booking.check_out);

            return (
              <article className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6" key={booking.id}>
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--sky)] font-semibold text-[var(--forest)]" aria-hidden="true">
                    {booking.contact_name.trim().charAt(0).toUpperCase() || "G"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{booking.contact_name}</h2>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {property?.name ?? "Property unavailable"} · {formatDate(booking.check_in)}–{formatDate(booking.check_out)} · {nights} {nights === 1 ? "night" : "nights"} · {booking.guest_count} {booking.guest_count === 1 ? "guest" : "guests"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <a className="underline underline-offset-4" href={`mailto:${booking.contact_email}`}>{booking.contact_email}</a>
                      {booking.contact_phone && <a className="underline underline-offset-4" href={`tel:${booking.contact_phone}`}>{booking.contact_phone}</a>}
                    </div>
                  </div>
                  <div className="lg:text-right">
                    <p className="text-sm text-[var(--muted)]">Guest total</p>
                    <p className="font-semibold">{formatMoney(booking.total_amount, booking.currency_code)}</p>
                  </div>
                  <Link className="w-fit rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold" href={`/booking/${booking.id}`}>
                    Booking details
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
