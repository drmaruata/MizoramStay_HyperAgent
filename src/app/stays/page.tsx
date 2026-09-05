import Image from "next/image";
import Link from "next/link";
import { z } from "zod";
import { listPublishedProperties } from "@/features/properties/repository";

export const metadata = {
  title: "Verified stays in Mizoram | MizoramStay",
  description: "Discover verified homestays and local stays across Mizoram.",
};

type Props = {
  searchParams: Promise<{
    destination?: string | string[];
    guests?: string | string[];
    maxRate?: string | string[];
    amenity?: string | string[];
  }>;
};

const filtersSchema = z.object({
  destination: z.string().trim().max(80).optional().catch(undefined),
  guests: z.coerce.number().int().min(1).max(20).optional().catch(undefined),
  maxRate: z.coerce.number().int().min(0).max(250_000).optional().catch(undefined),
  amenity: z.string().trim().max(80).optional().catch(undefined),
});

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function money(amount: number, currencyCode: string) {
  if (amount <= 0) return "Rates pending";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default async function StaysPage({ searchParams }: Props) {
  const rawParams = await searchParams;
  const filters = filtersSchema.parse({
    destination: one(rawParams.destination),
    guests: one(rawParams.guests),
    maxRate: one(rawParams.maxRate),
    amenity: one(rawParams.amenity),
  });

  let properties = await listPublishedProperties(filters);
  properties = properties.toSorted((first, second) => {
    const verificationRank = second.verification.localeCompare(first.verification);
    if (verificationRank !== 0) return verificationRank;
    return second.rating - first.rating;
  });

  const activeFilterCount = Object.values(filters).filter((value) => value !== undefined && value !== "").length;

  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
        <Link className="brand-mark text-xl font-bold" href="/">mizoram<span>stay</span></Link>
        <Link href="/" className="text-sm font-semibold underline underline-offset-4">Back to home</Link>
      </header>

      <section className="mx-auto max-w-7xl px-5 pb-16 pt-8 sm:px-8 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="eyebrow">Stays across Mizoram</p>
            <h1 className="mt-3 max-w-2xl text-5xl font-semibold tracking-tight">Find a verified local stay.</h1>
            <p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">Browse published properties with guest capacity, amenities, guest feedback, and current marketplace verification signals.</p>
          </div>
          <p className="rounded-full bg-[var(--sand)] px-4 py-2 text-sm font-semibold" role="status">
            {properties.length} stay{properties.length === 1 ? "" : "s"}
          </p>
        </div>

        <form className="mt-8 grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4 md:grid-cols-2 xl:grid-cols-[1.2fr_.7fr_.7fr_.8fr_auto]" method="get">
          <label className="grid gap-1 text-sm font-semibold" htmlFor="destination">
            Destination
            <input className="rounded-xl border border-[var(--line)] px-3 py-3 font-normal outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]" id="destination" name="destination" defaultValue={filters.destination ?? ""} placeholder="Aizawl, Reiek, Thenzawl" />
          </label>
          <label className="grid gap-1 text-sm font-semibold" htmlFor="guests">
            Guests
            <input className="rounded-xl border border-[var(--line)] px-3 py-3 font-normal outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]" id="guests" name="guests" type="number" min="1" max="20" defaultValue={filters.guests ?? ""} placeholder="2" />
          </label>
          <label className="grid gap-1 text-sm font-semibold" htmlFor="maxRate">
            Max rate
            <input className="rounded-xl border border-[var(--line)] px-3 py-3 font-normal outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]" id="maxRate" name="maxRate" type="number" min="0" max="250000" defaultValue={filters.maxRate ?? ""} placeholder="4000" />
          </label>
          <label className="grid gap-1 text-sm font-semibold" htmlFor="amenity">
            Amenity
            <input className="rounded-xl border border-[var(--line)] px-3 py-3 font-normal outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]" id="amenity" name="amenity" defaultValue={filters.amenity ?? ""} placeholder="wi-fi" />
          </label>
          <button className="self-end rounded-xl bg-[var(--deep)] px-5 py-3 text-sm font-semibold text-white">
            Search
          </button>
        </form>

        {activeFilterCount > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-[var(--muted)]">{activeFilterCount} active filter{activeFilterCount === 1 ? "" : "s"}</span>
            <Link className="font-semibold text-[var(--forest)] underline underline-offset-4" href="/stays">Clear filters</Link>
          </div>
        )}

        {properties.length === 0 ? (
          <section className="mt-10 rounded-2xl border border-dashed border-[var(--line)] bg-white p-8">
            <h2 className="text-xl font-semibold">No published stays match those filters</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">Try a broader destination, fewer guests, or a higher nightly rate. Published properties appear here after marketplace review.</p>
          </section>
        ) : (
          <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {properties.map((property) => (
              <article key={property.id} className="stay-card overflow-hidden">
                {property.coverImageUrl ? (
                  <figure className="relative h-56 bg-[var(--sand)]">
                    <Image className="object-cover" src={property.coverImageUrl} alt={property.coverImageAlt ?? property.name} fill sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw" />
                  </figure>
                ) : (
                  <div className="stay-art stay-one h-56" aria-label={`${property.name} in ${property.destination}`} role="img">
                    <span /><i className="art-mountain one" /><i className="art-mountain two" /><b className="art-house" />
                  </div>
                )}
                <div className="p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{property.destination}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">{property.locality ?? "Mizoram"} · Up to {property.maxGuests} guest{property.maxGuests === 1 ? "" : "s"}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[var(--sky)] px-2.5 py-1 text-xs font-semibold text-[var(--forest)]">{property.verification}</span>
                  </div>
                  <h2 className="mt-4 text-2xl font-semibold">{property.name}</h2>
                  <p className="mt-3 line-clamp-3 leading-6 text-[var(--muted)]">{property.description}</p>
                  {property.amenities.length > 0 && (
                    <ul className="mt-4 flex flex-wrap gap-2">
                      {property.amenities.map((amenity) => <li className="rounded-full bg-[var(--sand)] px-2.5 py-1 text-xs font-semibold" key={amenity}>{amenity}</li>)}
                    </ul>
                  )}
                  <div className="mt-6 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-lg font-semibold">{money(property.rate, property.currencyCode)} <span className="text-sm font-normal text-[var(--muted)]">{property.rate > 0 ? "night" : ""}</span></p>
                      <p className="mt-1 text-sm text-[var(--muted)]">{property.reviews ? `★ ${property.rating.toFixed(1)} (${property.reviews})` : "New to MizoramStay"}</p>
                    </div>
                    <Link className="rounded-full bg-[var(--deep)] px-4 py-2 text-sm font-semibold text-white" href={`/stays/${property.slug}`}>View stay</Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
