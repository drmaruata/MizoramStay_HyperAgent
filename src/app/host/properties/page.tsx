import Link from "next/link";
import { redirect } from "next/navigation";
import { PropertyWorkspace } from "@/components/host/property-workspace";
import { createClient } from "@/lib/supabase/server";

type HostPropertiesPageProps = {
  searchParams: Promise<{ propertyId?: string }>;
};

const propertySelection = "id,slug,name,summary,description,address_line1,address_line2,locality,postal_code,latitude,longitude,check_in_time,check_out_time,status,max_guests,created_at";

export default async function HostPropertiesPage({ searchParams }: HostPropertiesPageProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/host/properties")}`);

  const { propertyId } = await searchParams;
  let propertyQuery = supabase
    .from("properties")
    .select(propertySelection)
    .eq("host_id", user.id);

  propertyQuery = propertyId
    ? propertyQuery.eq("id", propertyId)
    : propertyQuery.order("created_at", { ascending: false }).limit(1);

  const { data: properties, error: propertyError } = await propertyQuery;
  const property = properties?.[0] ?? null;
  const { data: amenityRows, error: amenityError } = property
    ? await supabase
      .from("property_amenities")
      .select("amenity_id")
      .eq("property_id", property.id)
    : { data: [], error: null };
  const error = propertyError ?? amenityError;
  const workspaceProperty = property ? {
    id: property.id,
    slug: property.slug,
    name: property.name,
    summary: property.summary,
    description: property.description,
    addressLine1: property.address_line1,
    addressLine2: property.address_line2,
    locality: property.locality,
    postalCode: property.postal_code,
    latitude: property.latitude === null ? null : Number(property.latitude),
    longitude: property.longitude === null ? null : Number(property.longitude),
    checkInTime: property.check_in_time,
    checkOutTime: property.check_out_time,
    maxGuests: property.max_guests,
    status: property.status,
  } : null;

  return <main className="min-h-screen bg-[var(--paper)]">
    <header className="border-b border-[var(--line)] bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><Link href="/" className="brand-mark text-lg font-bold">mizoram<span>stay</span></Link><Link href="/host/dashboard" className="text-sm font-semibold">Host dashboard</Link></div></header>
    <section className="mx-auto max-w-6xl px-5 py-9 sm:py-12">
      <p className="eyebrow">Listing editor</p><h1 className="serif mt-2 text-4xl sm:text-5xl">Your properties</h1>
      <p className="mt-3 text-[var(--muted)]">Review and prepare the selected listing connected to your host account.</p>
      {error ? <p className="mt-8 rounded-2xl bg-[var(--sand)] p-5 text-sm text-[var(--terracotta)]" role="alert">Your property is temporarily unavailable. Please refresh and try again.</p> : property && workspaceProperty ? <>
        <div className="mt-8 grid gap-5 md:grid-cols-2"><article className="rounded-2xl border border-[var(--line)] bg-white p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">{property.name}</h2><p className="mt-1 text-sm text-[var(--muted)]">{[property.locality, property.address_line1].filter(Boolean).join(" · ") || "Location details pending"}</p></div><span className="rounded-full bg-[var(--sand)] px-2.5 py-1 text-xs font-semibold capitalize">{property.status.replaceAll("_", " ")}</span></div><p className="mt-5 text-sm leading-6 text-[var(--muted)]">{property.summary || "Add a summary to help guests understand your stay."}</p><dl className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--line)] pt-5"><div><dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Capacity</dt><dd className="mt-1 font-semibold">Up to {property.max_guests} guests</dd></div><div><dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Rooms</dt><dd className="mt-1"><Link href="/host/rooms" className="font-semibold text-[var(--forest)]">Manage rooms</Link></dd></div></dl></article></div>
        <PropertyWorkspace property={workspaceProperty} initialAmenityIds={(amenityRows ?? []).map((row) => row.amenity_id)} />
      </> : <section className="mt-8 rounded-2xl border border-dashed border-[var(--line)] bg-white p-8 sm:p-10"><h2 className="text-xl font-semibold">You have no properties yet</h2><p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">Start your first listing to add rooms, set availability, and prepare it for guest review.</p><Link href="/host/onboarding" className="mt-6 inline-flex rounded-full bg-[var(--terracotta)] px-5 py-3 text-sm font-semibold text-white">Create a property</Link></section>}
    </section>
  </main>;
}
