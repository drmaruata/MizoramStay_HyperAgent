import Link from "next/link";
import { redirect } from "next/navigation";
import PropertyOnboardingForm from "@/components/host/property-onboarding-form";
import { createClient } from "@/lib/supabase/server";

const steps = [
  ["01", "Tell us about your place", "Add the essentials guests look for first.", "Complete"],
  ["02", "Set up your listing", "Photos, amenities and house notes.", "In progress"],
  ["03", "Verify your details", "A quick check before your listing goes live.", "Up next"],
  ["04", "Choose your availability", "Open dates and your preferred booking settings.", "Up next"],
];

export default async function HostOnboardingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/host/onboarding")}`);

  const { data: destinations, error: destinationsError } = await supabase
    .from("destinations")
    .select("id,name,slug")
    .eq("is_active", true)
    .order("name");

  return <main className="min-h-screen bg-[var(--paper)]">
    <header className="border-b border-[var(--line)] bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><Link href="/" className="brand-mark text-lg font-bold">mizoram<span>stay</span></Link><Link href="/host/properties" className="text-sm font-semibold">Your properties</Link></div></header>
    <section className="mx-auto max-w-4xl px-5 py-9 sm:py-14">
      <div className="max-w-2xl"><p className="eyebrow">Start hosting</p><h1 className="serif mt-3 text-4xl leading-tight sm:text-5xl">Bring your Mizoram stay to life.</h1><p className="mt-4 max-w-xl text-[var(--muted)]">Create the listing guests will discover, then add rooms, photos, documents, amenities, and availability from your property workspace.</p></div>
      {destinationsError ? <p className="mt-9 rounded-2xl bg-[var(--sand)] p-5 text-sm text-[var(--terracotta)]">Destinations are temporarily unavailable. Please refresh and try again.</p> : destinations?.length ? <div className="mt-9"><PropertyOnboardingForm destinations={destinations} /></div> : <p className="mt-9 rounded-2xl bg-[var(--sand)] p-5 text-sm text-[var(--terracotta)]">No active destinations are available. Ask an administrator to create a destination before adding a property.</p>}
      <section aria-label="Onboarding progress" className="mt-9 rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7"><div className="flex items-end justify-between gap-4"><div><p className="text-sm font-semibold">Your hosting setup</p><p className="mt-1 text-sm text-[var(--muted)]">1 of 4 stages completed</p></div><p className="text-2xl font-semibold">25%</p></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--sand)]" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={25}><div className="h-full w-1/4 rounded-full bg-[var(--forest)]" /></div></section>
      <div className="mt-5 space-y-3">{steps.map(([number, title, detail, status], index) => <article className="flex gap-4 rounded-2xl border border-[var(--line)] bg-white p-5 sm:items-center sm:p-6" key={title}><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${index === 0 ? "bg-[var(--forest)] text-white" : index === 1 ? "bg-[var(--gold)] text-[var(--ink)]" : "bg-[var(--sand)] text-[var(--muted)]"}`}>{index === 0 ? "✓" : number}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h2 className="font-semibold">{title}</h2><span className={`text-xs font-semibold ${index < 2 ? "text-[var(--forest)]" : "text-[var(--muted)]"}`}>{status}</span></div><p className="mt-1 text-sm text-[var(--muted)]">{detail}</p></div>{index === 1 && <button type="button" className="shrink-0 rounded-full bg-[var(--terracotta)] px-4 py-2 text-sm font-semibold text-white">Continue<span className="sr-only"> setup for {title}</span></button>}</article>)}</div>
      <aside className="mt-7 rounded-2xl border border-[var(--line)] bg-[var(--sky)] p-5" aria-label="Document privacy"><div className="flex gap-3"><div aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white font-bold text-[var(--forest)]">⌁</div><div><h2 className="font-semibold">Your documents stay private</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">We only use verification documents to review your host profile. They are not shown to guests or included on your public listing.</p></div></div></aside>
    </section>
  </main>;
}
