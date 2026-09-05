import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

type PaymentRow = {
  id: string;
  booking_id: string;
  provider: string;
  provider_payment_id: string;
  provider_order_id: string | null;
  status: string;
  amount: number | string;
  currency_code: string;
  paid_at: string | null;
  created_at: string;
};

type RefundRow = {
  id: string;
  payment_id: string;
  booking_id: string;
  provider: string;
  provider_refund_id: string | null;
  status: string;
  amount: number | string;
  currency_code: string;
  reason: string;
  failure_reason: string | null;
  requested_at: string;
  completed_at: string | null;
  updated_at: string;
};

type PayoutRow = {
  id: string;
  booking_id: string;
  provider_payout_id: string | null;
  status: string;
  gross_amount: number | string;
  refund_amount: number | string;
  platform_fee: number | string;
  amount: number | string;
  currency_code: string;
  available_at: string;
  paid_at: string | null;
  failure_reason: string | null;
};

type BookingRow = { id: string; property_id: string; status: string; total_amount: number | string; currency_code: string };
type PropertyRow = { id: string; name: string };
type SearchParams = { refund?: string | string[]; detail?: string | string[] };
type Props = { searchParams: Promise<SearchParams> };
type ExceptionItem = { id: string; scope: string; message: string };

const refundTriggerSchema = z.object({ refundId: z.string().uuid() }).strict();

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const itemKey = key(item);
    groups.set(itemKey, [...(groups.get(itemKey) ?? []), item]);
  }
  return groups;
}

function numberValue(value: number | string) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value: number | string, currency = "INR") {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(numberValue(value));
  } catch {
    return `${currency} ${numberValue(value).toFixed(2)}`;
  }
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date);
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function statusClass(status: string) {
  if (["captured", "completed", "paid", "refunded"].includes(status)) return "bg-emerald-100 text-emerald-900";
  if (["failed", "cancelled"].includes(status)) return "bg-red-100 text-red-900";
  if (["processing", "authorized", "partially_refunded"].includes(status)) return "bg-blue-100 text-blue-900";
  return "bg-[var(--sand)] text-[var(--deep)]";
}

async function triggerRefund(formData: FormData) {
  "use server";

  const parsed = refundTriggerSchema.safeParse({ refundId: formData.get("refundId") });
  if (!parsed.success) redirect("/admin/payments?refund=invalid");

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const { data: adminProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (profileError) redirect("/admin/payments?refund=access-error");
  if (!adminProfile) redirect("/");

  const { data: refund, error: refundError } = await supabase
    .from("refunds")
    .select("id,status")
    .eq("id", parsed.data.refundId)
    .maybeSingle<{ id: string; status: string }>();
  if (refundError || !refund) redirect("/admin/payments?refund=not-found");
  if (!(["requested", "failed"] as string[]).includes(refund.status)) redirect("/admin/payments?refund=not-actionable");

  const { data, error } = await supabase.functions.invoke("refund-payment", { body: { refundId: refund.id } });
  if (error) redirect(`/admin/payments?refund=provider-error&detail=${encodeURIComponent(error.message.slice(0, 160))}`);

  const response = data && typeof data === "object" ? data as Record<string, unknown> : null;
  if (!response || typeof response.status !== "string" || typeof response.refundId !== "string") {
    redirect("/admin/payments?refund=invalid-response");
  }
  redirect(`/admin/payments?refund=triggered&detail=${encodeURIComponent(response.status)}`);
}

export default async function PaymentsPage({ searchParams }: Props) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const { data: adminProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (profileError) throw new Error("Unable to verify administrator access.");
  if (!adminProfile) redirect("/");

  const [paymentsResult, refundsResult, payoutsResult, bookingsResult, propertiesResult] = await Promise.all([
    supabase.from("payments").select("id,booking_id,provider,provider_payment_id,provider_order_id,status,amount,currency_code,paid_at,created_at").order("created_at", { ascending: false }).limit(300),
    supabase.from("refunds").select("id,payment_id,booking_id,provider,provider_refund_id,status,amount,currency_code,reason,failure_reason,requested_at,completed_at,updated_at").order("requested_at", { ascending: false }).limit(300),
    supabase.from("host_payouts").select("id,booking_id,provider_payout_id,status,gross_amount,refund_amount,platform_fee,amount,currency_code,available_at,paid_at,failure_reason").order("available_at", { ascending: false }).limit(300),
    supabase.from("bookings").select("id,property_id,status,total_amount,currency_code").limit(1000),
    supabase.from("properties").select("id,name").limit(1000),
  ]);

  const payments = (paymentsResult.data ?? []) as PaymentRow[];
  const refunds = (refundsResult.data ?? []) as RefundRow[];
  const payouts = (payoutsResult.data ?? []) as PayoutRow[];
  const bookings = (bookingsResult.data ?? []) as BookingRow[];
  const properties = (propertiesResult.data ?? []) as PropertyRow[];
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  const propertyById = new Map(properties.map((property) => [property.id, property]));
  const refundsByPayment = groupBy(refunds, (refund) => refund.payment_id);
  const paymentsByBooking = groupBy(payments, (payment) => payment.booking_id);
  const exceptions: ExceptionItem[] = [];
  const renderedAt = new Date().getTime();

  for (const refund of refunds) {
    if (refund.status === "failed") exceptions.push({ id: refund.id, scope: "Refund", message: refund.failure_reason || "Provider refund failed without a recorded reason" });
    if (refund.status === "processing" && renderedAt - new Date(refund.updated_at).getTime() > 30 * 60 * 1000) exceptions.push({ id: refund.id, scope: "Refund", message: "Refund has remained processing for more than 30 minutes" });
  }
  for (const payment of payments) {
    const completedRefundTotal = (refundsByPayment.get(payment.id) ?? []).filter((refund) => refund.status === "completed").reduce((total, refund) => total + numberValue(refund.amount), 0);
    if (completedRefundTotal > numberValue(payment.amount) + 0.001) exceptions.push({ id: payment.id, scope: "Payment", message: "Completed refunds exceed captured payment amount" });
    if (payment.status === "refunded" && Math.abs(completedRefundTotal - numberValue(payment.amount)) > 0.001) exceptions.push({ id: payment.id, scope: "Payment", message: "Payment is marked refunded but completed refund total does not match" });
  }
  for (const booking of bookings) {
    const captured = (paymentsByBooking.get(booking.id) ?? []).filter((payment) => ["captured", "partially_refunded", "refunded"].includes(payment.status)).reduce((total, payment) => total + numberValue(payment.amount), 0);
    if (booking.status === "confirmed" && Math.abs(captured - numberValue(booking.total_amount)) > 0.001) exceptions.push({ id: booking.id, scope: "Booking", message: `Captured balance ${formatMoney(captured, booking.currency_code)} does not match booking total ${formatMoney(booking.total_amount, booking.currency_code)}` });
  }
  for (const payout of payouts) {
    const expected = numberValue(payout.gross_amount) - numberValue(payout.refund_amount) - numberValue(payout.platform_fee);
    if (payout.status === "failed") exceptions.push({ id: payout.id, scope: "Payout", message: payout.failure_reason || "Payout failed without a recorded reason" });
    if (Math.abs(expected - numberValue(payout.amount)) > 0.001) exceptions.push({ id: payout.id, scope: "Payout", message: "Net payout does not reconcile to gross minus refunds and fees" });
  }

  const query = await searchParams;
  const refundNotice = typeof query.refund === "string" ? query.refund : undefined;
  const detail = typeof query.detail === "string" ? query.detail : undefined;
  const noticeText: Record<string, string> = {
    triggered: `Refund provider trigger returned ${detail ? label(detail) : "a response"}. Durable refund status below remains the source of truth.`,
    invalid: "Refund request was rejected because its identifier was invalid.",
    "access-error": "Administrator access could not be verified for the refund request.",
    "not-found": "Refund record was not found or could not be read.",
    "not-actionable": "Only requested or failed refunds can be sent to the provider.",
    "provider-error": `Refund provider operation failed${detail ? `: ${detail}` : "."}`,
    "invalid-response": "Refund service returned an invalid response; review the durable queue before retrying.",
  };
  const grossCaptured = payments.filter((payment) => ["captured", "partially_refunded", "refunded"].includes(payment.status)).reduce((total, payment) => total + numberValue(payment.amount), 0);
  const completedRefunds = refunds.filter((refund) => refund.status === "completed").reduce((total, refund) => total + numberValue(refund.amount), 0);
  const payable = payouts.filter((payout) => ["pending", "processing"].includes(payout.status)).reduce((total, payout) => total + numberValue(payout.amount), 0);
  const hasDataError = [paymentsResult.error, refundsResult.error, payoutsResult.error, bookingsResult.error, propertiesResult.error].some(Boolean);
  const propertyName = (bookingId: string) => {
    const booking = bookingById.get(bookingId);
    return booking ? propertyById.get(booking.property_id)?.name ?? "Property unavailable" : "Booking unavailable";
  };

  return <main className="min-h-screen bg-[var(--paper)]">
    <header className="border-b border-[var(--line)] bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4"><Link className="brand-mark font-bold" href="/">mizoram<span>stay</span></Link><span className="rounded-full bg-[var(--deep)] px-3 py-1 text-sm font-semibold text-white">Administrator operations</span></div></header>
    <section className="mx-auto max-w-7xl px-5 py-10">
      <p className="eyebrow">Payments &amp; reconciliation</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-4xl font-semibold">Settlement monitor</h1><p className="mt-2 text-[var(--muted)]">Live provider payments, refund work, payout balances, and reconciliation checks.</p></div><Link className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-semibold" href="/admin/bookings">Open booking desk</Link></div>
      {refundNotice && noticeText[refundNotice] && <p className={`mt-6 rounded-xl border px-4 py-3 text-sm ${refundNotice === "triggered" ? "border-blue-200 bg-blue-50 text-blue-900" : "border-red-200 bg-red-50 text-red-900"}`} role="status">{noticeText[refundNotice]}</p>}
      {hasDataError && <p className="mt-6 rounded-xl border border-[var(--gold)] bg-[var(--sand)] px-4 py-3 text-sm text-[var(--terracotta)]" role="alert">Some transaction records could not be loaded. Totals and reconciliation checks may be incomplete.</p>}

      <div className="mt-8 grid gap-4 md:grid-cols-4">{[[formatMoney(grossCaptured), "Captured payment volume"], [formatMoney(completedRefunds), "Completed refunds"], [formatMoney(payable), "Pending / processing payouts"], [String(exceptions.length), "Reconciliation exceptions"]].map(([value, heading]) => <article key={heading} className="rounded-2xl border border-[var(--line)] bg-white p-5"><p className="text-3xl font-semibold">{value}</p><p className="mt-1 text-sm text-[var(--muted)]">{heading}</p></article>)}</div>

      <section className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-white" aria-labelledby="payments-heading">
        <div className="border-b border-[var(--line)] px-6 py-5"><h2 id="payments-heading" className="text-xl font-semibold">Payment ledger</h2><p className="mt-1 text-sm text-[var(--muted)]">Provider identifiers and durable payment states, newest first.</p></div>
        {payments.length === 0 ? <p className="p-6 text-sm text-[var(--muted)]">No payment records are available.</p> : <div className="overflow-x-auto"><table className="w-full min-w-250 text-left text-sm"><thead className="bg-[var(--sand)] text-[var(--muted)]"><tr>{["Payment", "Booking / property", "Provider reference", "Amount", "Status", "Paid / created", "Completed refunds"].map((heading) => <th key={heading} className="px-5 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[var(--line)]">{payments.map((payment) => {
          const completed = (refundsByPayment.get(payment.id) ?? []).filter((refund) => refund.status === "completed").reduce((total, refund) => total + numberValue(refund.amount), 0);
          return <tr key={payment.id}><td className="px-5 py-4 font-mono text-xs font-semibold">{payment.id.slice(0, 8)}</td><td className="px-5 py-4"><p className="font-semibold">{propertyName(payment.booking_id)}</p><p className="mt-1 font-mono text-xs text-[var(--muted)]">{payment.booking_id.slice(0, 8)}</p></td><td className="px-5 py-4"><p className="font-mono text-xs">{payment.provider_payment_id}</p><p className="mt-1 text-xs capitalize text-[var(--muted)]">{payment.provider}{payment.provider_order_id ? ` · order ${payment.provider_order_id}` : " · no order id"}</p></td><td className="px-5 py-4 font-semibold">{formatMoney(payment.amount, payment.currency_code)}</td><td className="px-5 py-4"><span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${statusClass(payment.status)}`}>{label(payment.status)}</span></td><td className="px-5 py-4 text-xs">{formatDate(payment.paid_at ?? payment.created_at)} IST</td><td className="px-5 py-4">{formatMoney(completed, payment.currency_code)}</td></tr>;
        })}</tbody></table></div>}
      </section>

      <section className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-white" aria-labelledby="refunds-heading">
        <div className="border-b border-[var(--line)] px-6 py-5"><h2 id="refunds-heading" className="text-xl font-semibold">Refund queue</h2><p className="mt-1 text-sm text-[var(--muted)]">Only durable requested or failed records can be triggered. Provider execution and database reconciliation remain server-owned.</p></div>
        {refunds.length === 0 ? <p className="p-6 text-sm text-[var(--muted)]">No refund records are available.</p> : <div className="overflow-x-auto"><table className="w-full min-w-280 text-left text-sm"><thead className="bg-[var(--sand)] text-[var(--muted)]"><tr>{["Refund", "Booking / property", "Amount", "Status", "Provider refund", "Reason / exception", "Requested", "Operation"].map((heading) => <th key={heading} className="px-5 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[var(--line)]">{refunds.map((refund) => <tr key={refund.id} className={refund.status === "failed" ? "bg-red-50/50" : undefined}><td className="px-5 py-4 font-mono text-xs font-semibold">{refund.id.slice(0, 8)}</td><td className="px-5 py-4"><p className="font-semibold">{propertyName(refund.booking_id)}</p><p className="mt-1 font-mono text-xs text-[var(--muted)]">Payment {refund.payment_id.slice(0, 8)}</p></td><td className="px-5 py-4 font-semibold">{formatMoney(refund.amount, refund.currency_code)}</td><td className="px-5 py-4"><span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${statusClass(refund.status)}`}>{label(refund.status)}</span>{refund.completed_at && <p className="mt-2 text-xs text-[var(--muted)]">Completed {formatDate(refund.completed_at)} IST</p>}</td><td className="px-5 py-4 font-mono text-xs">{refund.provider_refund_id ?? "Not assigned"}</td><td className="max-w-80 px-5 py-4"><p>{refund.reason}</p>{refund.failure_reason && <p className="mt-2 font-semibold text-red-800">{refund.failure_reason}</p>}</td><td className="px-5 py-4 text-xs">{formatDate(refund.requested_at)} IST</td><td className="px-5 py-4">{["requested", "failed"].includes(refund.status) ? <form action={triggerRefund}><input type="hidden" name="refundId" value={refund.id} /><button className="rounded-full bg-[var(--forest)] px-3 py-2 text-xs font-semibold text-white" type="submit">{refund.status === "failed" ? "Retry provider" : "Send to provider"}<span className="sr-only"> for refund {refund.id}</span></button></form> : <span className="text-xs text-[var(--muted)]">No manual action</span>}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="mt-8 overflow-hidden rounded-2xl border border-[var(--line)] bg-white" aria-labelledby="payouts-heading">
        <div className="border-b border-[var(--line)] px-6 py-5"><h2 id="payouts-heading" className="text-xl font-semibold">Payout reconciliation</h2><p className="mt-1 text-sm text-[var(--muted)]">Gross captured balance minus completed refunds and platform fees must equal the net payout.</p></div>
        {payouts.length === 0 ? <p className="p-6 text-sm text-[var(--muted)]">No payout records are available.</p> : <div className="overflow-x-auto"><table className="w-full min-w-240 text-left text-sm"><thead className="bg-[var(--sand)] text-[var(--muted)]"><tr>{["Payout", "Booking / property", "Gross", "Refunds", "Fees", "Net payout", "Status", "Available / paid"].map((heading) => <th key={heading} className="px-5 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[var(--line)]">{payouts.map((payout) => <tr key={payout.id} className={payout.status === "failed" ? "bg-red-50/50" : undefined}><td className="px-5 py-4"><p className="font-mono text-xs font-semibold">{payout.id.slice(0, 8)}</p><p className="mt-1 font-mono text-xs text-[var(--muted)]">{payout.provider_payout_id ?? "No provider id"}</p></td><td className="px-5 py-4"><p className="font-semibold">{propertyName(payout.booking_id)}</p><p className="mt-1 font-mono text-xs text-[var(--muted)]">{payout.booking_id.slice(0, 8)}</p></td><td className="px-5 py-4">{formatMoney(payout.gross_amount, payout.currency_code)}</td><td className="px-5 py-4">{formatMoney(payout.refund_amount, payout.currency_code)}</td><td className="px-5 py-4">{formatMoney(payout.platform_fee, payout.currency_code)}</td><td className="px-5 py-4 font-semibold">{formatMoney(payout.amount, payout.currency_code)}</td><td className="px-5 py-4"><span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${statusClass(payout.status)}`}>{label(payout.status)}</span>{payout.failure_reason && <p className="mt-2 max-w-64 text-xs font-semibold text-red-800">{payout.failure_reason}</p>}</td><td className="px-5 py-4 text-xs">{formatDate(payout.paid_at ?? payout.available_at)} IST</td></tr>)}</tbody></table></div>}
      </section>

      <section className="mt-8 rounded-2xl border border-[var(--line)] bg-white p-6" aria-labelledby="exceptions-heading"><h2 id="exceptions-heading" className="text-xl font-semibold">Reconciliation exceptions</h2><p className="mt-1 text-sm text-[var(--muted)]">Payment/refund balance mismatches, failed or stale refund work, and payout equation failures.</p>{exceptions.length === 0 ? <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">No reconciliation exceptions detected in the loaded transaction records.</p> : <div className="mt-5 grid gap-3 md:grid-cols-2">{exceptions.map((item, index) => <article className="rounded-xl border border-red-200 bg-red-50 p-4" key={`${item.scope}-${item.id}-${index}`}><div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{item.scope}</h3><span className="font-mono text-xs">{item.id.slice(0, 8)}</span></div><p className="mt-2 text-sm text-red-900">{item.message}</p></article>)}</div>}</section>
    </section>
  </main>;
}
