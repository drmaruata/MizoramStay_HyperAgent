import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingRequestForm } from "@/components/booking/booking-request-form";
import { getPublishedPropertyBySlug } from "@/features/properties/public-repository";
import { createClient } from "@/lib/supabase/server";

type Props = { params: Promise<{ slug: string }> };

// Property visibility changes in the public catalog must be reflected immediately.
export const dynamic = "force-dynamic";

function formatRate(rate: number, currencyCode: string) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(rate);
  } catch {
    return `${currencyCode} ${rate.toLocaleString("en-IN")}`;
  }
}

function formatReviewDate(date: string) {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(new Date(date));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const property = await getPublishedPropertyBySlug(slug);

  if (!property) return { title: "Stay not found" };

  const description = property.summary ?? property.description ?? `Book ${property.name} in ${property.destination.name}, ${property.destination.state}.`;
  const coverImage = property.media.find((item) => item.kind === "image" && item.isCover) ?? property.media.find((item) => item.kind === "image");

  return {
    title: property.name,
    description,
    openGraph: {
      title: `${property.name} in ${property.destination.name}`,
      description,
      images: coverImage ? [{ url: coverImage.url, alt: coverImage.altText ?? property.name }] : undefined,
    },
  };
}

export default async function StayPage({ params }: Props) {
  const { slug } = await params;
  const property = await getPublishedPropertyBySlug(slug);

  if (!property) notFound();

  const supabase = await createClient();
  const { data: propertyIdentity, error: propertyIdentityError } = await supabase
    .from("properties")
    .select("id")
    .eq("slug", property.slug)
    .eq("status", "published")
    .maybeSingle();
  if (propertyIdentityError || !propertyIdentity) {
    throw new Error("Unable to load booking details for this property.");
  }

  const images = property.media.filter((item) => item.kind === "image");
  const coverImage = images.find((item) => item.isCover) ?? images[0];
  const galleryImages = images.filter((item) => item.id !== coverImage?.id).slice(0, 4);
  const lowestRate = property.rooms[0];
  const reviewAverage = property.reviews.length
    ? property.reviews.reduce((total, review) => total + review.rating, 0) / property.reviews.length
    : null;

  return (
    <main className="min-h-screen bg-[var(--paper)]">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-10">
        <Link className="brand-mark text-xl font-bold" href="/">mizoram<span>stay</span></Link>
        <Link href="/stays" className="text-sm font-semibold underline underline-offset-4">All stays</Link>
      </header>

      <section className="mx-auto max-w-7xl px-5 pb-20 pt-8 sm:px-8 lg:px-10">
        <p className="eyebrow">{property.destination.name}, {property.destination.state}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{property.name}</h1>
        <p className="mt-4 max-w-3xl text-lg text-[var(--muted)]">{property.summary ?? `A locally hosted stay in ${property.destination.name}.`}</p>
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--muted)]">
          {reviewAverage !== null ? <span>★ {reviewAverage.toFixed(1)} ({property.reviews.length} {property.reviews.length === 1 ? "review" : "reviews"})</span> : <span>New to MizoramStay</span>}
          <span aria-hidden="true">·</span>
          <Link href={`/destinations/${property.destination.slug}`} className="font-semibold underline underline-offset-4">Explore {property.destination.name}</Link>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {coverImage ? <figure className="relative min-h-72 overflow-hidden rounded-3xl bg-[var(--sand)] sm:row-span-2 lg:col-span-2"><Image className="object-cover" src={coverImage.url} alt={coverImage.altText ?? `${property.name} exterior`} fill priority sizes="(min-width: 1024px) 66vw, 100vw" /></figure> : <div className="stay-art stay-two min-h-72 rounded-3xl sm:row-span-2 lg:col-span-2" aria-label={`${property.name} in ${property.destination.name}`} role="img"><span /><i className="art-mountain one" /><i className="art-mountain two" /><b className="art-house" /></div>}
          {galleryImages.map((image) => <figure className="relative min-h-44 overflow-hidden rounded-2xl bg-[var(--sand)]" key={image.id}><Image className="object-cover" src={image.url} alt={image.altText ?? `${property.name} photo`} fill sizes="(min-width: 1024px) 33vw, 50vw" /></figure>)}
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1.5fr_0.75fr]">
          <div>
            <section aria-labelledby="about-heading"><h2 id="about-heading" className="text-2xl font-semibold">About this stay</h2><p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">{property.description ?? property.summary ?? "Your host will share practical local guidance and clear arrival information before your stay."}</p><dl className="mt-6 grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border border-[var(--line)] bg-white p-4"><dt className="text-sm text-[var(--muted)]">Maximum guests</dt><dd className="mt-1 font-semibold">{property.maxGuests} {property.maxGuests === 1 ? "guest" : "guests"}</dd></div><div className="rounded-2xl border border-[var(--line)] bg-white p-4"><dt className="text-sm text-[var(--muted)]">Check-in</dt><dd className="mt-1 font-semibold">{property.checkInTime}</dd></div><div className="rounded-2xl border border-[var(--line)] bg-white p-4"><dt className="text-sm text-[var(--muted)]">Check-out</dt><dd className="mt-1 font-semibold">{property.checkOutTime}</dd></div></dl></section>

            {property.amenities.length > 0 && <section className="mt-10" aria-labelledby="amenities-heading"><h2 id="amenities-heading" className="text-2xl font-semibold">What is here</h2><ul className="mt-4 flex flex-wrap gap-3">{property.amenities.map((amenity) => <li className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm" key={amenity.slug}>{amenity.name}</li>)}</ul></section>}

            <section className="mt-10" aria-labelledby="rooms-heading"><h2 id="rooms-heading" className="text-2xl font-semibold">Choose a room</h2>{property.rooms.length > 0 ? <div className="mt-4 grid gap-4">{property.rooms.map((room) => <article className="rounded-2xl border border-[var(--line)] bg-white p-5" key={room.id}><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg font-semibold">{room.name}</h3>{room.description && <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">{room.description}</p>}<p className="mt-3 text-sm text-[var(--muted)]">Sleeps {room.capacityAdults} adult{room.capacityAdults === 1 ? "" : "s"}{room.capacityChildren > 0 ? ` · up to ${room.capacityChildren} child${room.capacityChildren === 1 ? "" : "ren"}` : ""}{room.bedsDescription ? ` · ${room.bedsDescription}` : ""}</p></div><p className="text-lg font-semibold">{formatRate(room.baseNightlyRate, room.currencyCode)} <span className="text-sm font-normal text-[var(--muted)]">night</span></p></div></article>)}</div> : <p className="mt-4 text-[var(--muted)]">Room availability will be shared by the host.</p>}</section>

            {property.reviews.length > 0 && <section className="mt-10" aria-labelledby="reviews-heading"><h2 id="reviews-heading" className="text-2xl font-semibold">Guest reviews</h2><div className="mt-4 grid gap-4">{property.reviews.map((review) => <article className="rounded-2xl border border-[var(--line)] bg-white p-5" key={review.id}><p className="font-semibold">★ {review.rating.toFixed(1)} <span className="ml-2 text-sm font-normal text-[var(--muted)]">{formatReviewDate(review.createdAt)}</span></p>{review.title && <h3 className="mt-3 font-semibold">{review.title}</h3>}{review.body && <p className="mt-2 leading-7 text-[var(--muted)]">{review.body}</p>}{review.hostResponse && <div className="mt-4 border-l-2 border-[var(--terracotta)] pl-4 text-sm leading-6 text-[var(--muted)]"><strong className="text-[var(--deep)]">Response from host</strong><p className="mt-1">{review.hostResponse}</p></div>}</article>)}</div></section>}

            <section className="mt-10 rounded-2xl border border-[var(--line)] bg-[var(--sand)] p-6" aria-labelledby="trust-heading"><h2 id="trust-heading" className="text-xl font-semibold">Verification explained</h2><p className="mt-2 leading-7 text-[var(--muted)]">MizoramStay verifies listing information and supporting documents. This does not represent a government endorsement or certification.</p></section>
          </div>

          <aside className="h-fit rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm lg:sticky lg:top-6" aria-label="Booking details">
            {lowestRate ? (
              <p className="text-2xl font-semibold">
                {formatRate(lowestRate.baseNightlyRate, lowestRate.currencyCode)} <span className="text-sm font-normal text-[var(--muted)]">night</span>
              </p>
            ) : (
              <p className="text-xl font-semibold">Contact host for rates</p>
            )}
            <p className="mt-2 text-sm text-[var(--muted)]">{lowestRate ? "From the lowest active room rate" : "No active rooms are currently listed."}</p>
            <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-xl border border-[var(--line)]">
              <div className="border-r border-[var(--line)] p-3 text-xs font-semibold uppercase tracking-wide">
                Check-in<span className="mt-2 block text-sm font-normal normal-case">{property.checkInTime}</span>
              </div>
              <div className="p-3 text-xs font-semibold uppercase tracking-wide">
                Check-out<span className="mt-2 block text-sm font-normal normal-case">{property.checkOutTime}</span>
              </div>
            </div>
            <BookingRequestForm
              propertyId={propertyIdentity.id}
              propertySlug={property.slug}
              propertyMaxGuests={property.maxGuests}
              rooms={property.rooms}
            />
          </aside>
        </div>
      </section>
    </main>
  );
}
