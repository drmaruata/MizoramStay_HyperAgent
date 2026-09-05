import Link from "next/link";
import {
  searchAvailableProperties,
  type AvailabilitySearchResult,
} from "@/features/search/availability-repository";
import { availabilitySearchSchema } from "@/lib/validation/search";

type SearchParams = {
  destination?: string | string[];
  checkIn?: string | string[];
  checkOut?: string | string[];
  guests?: string | string[];
};

type Props = { searchParams: Promise<SearchParams> };

function addUtcDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatMoney(value: number, currencyCode: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(value);
}

export default async function SearchPage({ searchParams }: Props) {
  const rawParams = await searchParams;
  const today = new Date();
  const formValues = {
    destination: firstValue(rawParams.destination) ?? "",
    checkIn: firstValue(rawParams.checkIn) ?? addUtcDays(today, 1),
    checkOut: firstValue(rawParams.checkOut) ?? addUtcDays(today, 2),
    guests: firstValue(rawParams.guests) ?? "1",
  };
  const parsed = availabilitySearchSchema.safeParse(formValues);

  let results: AvailabilitySearchResult[] = [];
  let errorMessage: string | null = null;

  if (!parsed.success) {
    errorMessage = "Choose valid dates and a guest count between 1 and 20.";
  } else {
    try {
      results = await searchAvailableProperties(parsed.data);
    } catch {
      errorMessage = "Availability search is temporarily unavailable. Please try again.";
    }
  }

  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
        <Link className="brand-mark text-xl font-bold" href="/">
          mizoram<span>stay</span>
        </Link>
        <Link href="/stays" className="text-sm font-semibold underline underline-offset-4">
          Browse all stays
        </Link>
      </header>

      <section className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 lg:px-10">
        <p className="eyebrow">Search stays</p>
        <h1 className="mt-3 text-4xl font-semibold">
          {formValues.destination.trim()
            ? `Available stays near ${formValues.destination}`
            : "Find an available stay"}
        </h1>

        <form className="mt-7 grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_0.8fr_auto]" method="get">
          <label className="grid gap-1 text-sm font-semibold" htmlFor="destination">
            Destination
            <input
              className="min-w-0 rounded-xl border border-[var(--line)] px-3 py-3 font-normal outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]"
              id="destination"
              name="destination"
              defaultValue={formValues.destination}
              maxLength={80}
              placeholder="Aizawl, Reiek, or Thenzawl"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold" htmlFor="checkIn">
            Check-in
            <input
              className="rounded-xl border border-[var(--line)] px-3 py-3 font-normal outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]"
              id="checkIn"
              name="checkIn"
              type="date"
              min={addUtcDays(today, 0)}
              defaultValue={formValues.checkIn}
              required
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold" htmlFor="checkOut">
            Check-out
            <input
              className="rounded-xl border border-[var(--line)] px-3 py-3 font-normal outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]"
              id="checkOut"
              name="checkOut"
              type="date"
              min={addUtcDays(today, 1)}
              defaultValue={formValues.checkOut}
              required
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold" htmlFor="guests">
            Guests
            <input
              className="rounded-xl border border-[var(--line)] px-3 py-3 font-normal outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]"
              id="guests"
              name="guests"
              type="number"
              min="1"
              max="20"
              defaultValue={formValues.guests}
              required
            />
          </label>
          <button className="self-end rounded-xl bg-[var(--deep)] px-5 py-3 text-sm font-semibold text-white">
            Search availability
          </button>
        </form>

        {errorMessage ? (
          <div className="mt-8 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900" role="alert">
            <p className="font-semibold">We could not complete that search.</p>
            <p className="mt-1 text-sm">{errorMessage}</p>
          </div>
        ) : (
          <>
            <p className="mt-8 text-sm text-[var(--muted)]" role="status">
              {results.length} available stay{results.length === 1 ? "" : "s"} found
            </p>
            <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {results.map((property) => (
                <article className="rounded-2xl border border-[var(--line)] bg-white p-5" key={property.propertyId}>
                  <p className="text-sm text-[var(--muted)]">
                    {property.destination.name}
                    {property.destination.locality ? ` · ${property.destination.locality}` : ""}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold">{property.name}</h2>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                    {property.summary ?? "A locally hosted stay in Mizoram."}
                  </p>
                  <p className="mt-4 text-sm">
                    <span className="font-semibold">{property.roomName}</span>
                    {` · up to ${property.maxGuests} guests · ${property.availableUnits} available`}
                  </p>
                  <div className="mt-5 flex items-end justify-between gap-4">
                    <p className="text-sm text-[var(--muted)]">
                      <span className="block text-lg font-semibold text-[var(--ink)]">
                        {formatMoney(property.minTotalPrice, property.currencyCode)} total
                      </span>
                      {formatMoney(property.minNightlyPrice, property.currencyCode)} per night
                    </p>
                    <Link className="shrink-0 font-semibold text-[var(--leaf)] underline underline-offset-4" href={`/stays/${property.slug}`}>
                      View stay
                    </Link>
                  </div>
                </article>
              ))}
            </div>
            {results.length === 0 && (
              <div className="mt-6 rounded-2xl bg-[var(--sand)] p-6">
                <p className="font-semibold">No stays are available for those dates.</p>
                <p className="mt-2 text-[var(--muted)]">Try another destination, date range, or guest count.</p>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
