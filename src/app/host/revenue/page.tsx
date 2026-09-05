import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type PropertySummary = {
  id: string;
  name: string;
};

type BookingSummary = {
  id: string;
  check_in: string;
  check_out: string;
  contact_name: string;
  properties: PropertySummary | PropertySummary[] | null;
};

type HostPayout = {
  id: string;
  status: "pending" | "processing" | "paid" | "failed" | "cancelled";
  gross_amount: number | string;
  refund_amount: number | string;
  platform_fee: number | string;
  amount: number | string;
  currency_code: string;
  available_at: string;
  paid_at: string | null;
  bookings: BookingSummary | BookingSummary[] | null;
};

const statusPresentation: Record<HostPayout["status"], { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-[var(--gold)] text-[var(--deep)]" },
  processing: { label: "Processing", className: "bg-[var(--sky)] text-[var(--deep)]" },
  paid: { label: "Paid", className: "bg-emerald-50 text-emerald-800" },
  failed: { label: "Failed", className: "bg-red-50 text-red-800" },
  cancelled: { label: "Cancelled", className: "bg-[var(--sand)] text-[var(--muted)]" },
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Host revenue and payouts",
  description: "Review payout amounts and statuses for your MizoramStay properties.",
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
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
        <p className="eyebrow">Payments</p>
        <h1 className="serif mt-2 text-4xl sm:text-5xl">Revenue &amp; payouts</h1>
        <p className="mt-3 text-[var(--muted)]">Payout records for reservations at the properties you host.</p>
        {children}
      </section>
    </main>
  );
}

function LoadError() {
  return (
    <PageShell>
      <div className="mt-8 rounded-2xl border border-red-200 bg-white p-6" role="alert">
        <h2 className="text-lg font-semibold">Payouts could not be loaded</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">We could not retrieve your payout records right now. Please refresh the page or try again later.</p>
      </div>
    </PageShell>
  );
}

export default async function HostRevenuePage() {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return <LoadError />;
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) return <LoadError />;
  if (!user) redirect(`/login?next=${encodeURIComponent("/host/revenue")}`);

  // This authenticated publishable-key query is constrained by host_id and the table's RLS policy.
  const { data, error } = await supabase
    .from("host_payouts")
    .select(`
      id,
      status,
      gross_amount,
      refund_amount,
      platform_fee,
      amount,
      currency_code,
      available_at,
      paid_at,
      bookings:booking_id (
        id,
        check_in,
        check_out,
        contact_name,
        properties:property_id (id, name)
      )
    `)
    .eq("host_id", user.id)
    .order("available_at", { ascending: false });

  if (error) return <LoadError />;

  const payouts = (data ?? []) as unknown as HostPayout[];
  const currencies = new Set(payouts.map((payout) => payout.currency_code));
  const singleCurrency = currencies.size === 1 ? payouts[0]?.currency_code : null;
  const totalNet = payouts.reduce((sum, payout) => sum + Number(payout.amount), 0);
  const paidNet = payouts.filter((payout) => payout.status === "paid").reduce((sum, payout) => sum + Number(payout.amount), 0);
  const inProgressNet = payouts
    .filter((payout) => payout.status === "pending" || payout.status === "processing")
    .reduce((sum, payout) => sum + Number(payout.amount), 0);
  const summaryValue = (amount: number) => singleCurrency ? formatMoney(amount, singleCurrency) : "Multiple currencies";

  return (
    <PageShell>
      {payouts.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-[var(--line)] bg-white p-6">
          <h2 className="text-lg font-semibold">No payouts yet</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Payout records will appear here after eligible bookings are prepared for settlement.</p>
          <Link className="mt-5 inline-block text-sm font-semibold underline underline-offset-4" href="/host/bookings">View host bookings</Link>
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              ["Total net", summaryValue(totalNet), `${payouts.length} ${payouts.length === 1 ? "payout" : "payouts"}`],
              ["Paid", summaryValue(paidNet), "Completed payouts"],
              ["Pending & processing", summaryValue(inProgressNet), "Not yet marked paid"],
            ].map(([label, value, detail]) => (
              <article className="rounded-2xl border border-[var(--line)] bg-white p-6" key={label}>
                <p className="text-sm text-[var(--muted)]">{label}</p>
                <p className="mt-3 text-3xl font-semibold">{value}</p>
                <p className="mt-2 text-sm text-[var(--muted)]">{detail}</p>
              </article>
            ))}
          </div>

          <section className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-white" aria-labelledby="payout-records">
            <div className="border-b border-[var(--line)] px-5 py-5 sm:px-6">
              <h2 className="text-xl font-semibold" id="payout-records">Payout records</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Gross booking value, deductions, and the resulting net payout.</p>
            </div>
            <div className="divide-y divide-[var(--line)]">
              {payouts.map((payout) => {
                const booking = one(payout.bookings);
                const property = one(booking?.properties);
                const status = statusPresentation[payout.status];

                return (
                  <article className="px-5 py-6 sm:px-6" key={payout.id}>
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{property?.name ?? "Property unavailable"}</h3>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
                        </div>
                        <p className="mt-2 text-sm text-[var(--muted)]">
                          {booking ? `${booking.contact_name} · ${formatDate(`${booking.check_in}T00:00:00Z`)}–${formatDate(`${booking.check_out}T00:00:00Z`)}` : "Booking details unavailable"}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {payout.status === "paid" && payout.paid_at ? `Paid ${formatDate(payout.paid_at)}` : `Available ${formatDate(payout.available_at)}`}
                        </p>
                      </div>
                      {booking && (
                        <Link className="w-fit text-sm font-semibold underline underline-offset-4" href={`/booking/${booking.id}`}>
                          Booking details
                        </Link>
                      )}
                    </div>
                    <dl className="mt-5 grid gap-4 rounded-xl bg-[var(--sand)] p-4 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-[var(--muted)]">Gross</dt>
                        <dd className="mt-1 font-semibold">{formatMoney(payout.gross_amount, payout.currency_code)}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">Refunds</dt>
                        <dd className="mt-1 font-semibold">−{formatMoney(payout.refund_amount, payout.currency_code)}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">Platform fee</dt>
                        <dd className="mt-1 font-semibold">−{formatMoney(payout.platform_fee, payout.currency_code)}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--muted)]">Net payout</dt>
                        <dd className="mt-1 font-semibold">{formatMoney(payout.amount, payout.currency_code)}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
    </PageShell>
  );
}
