import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PropertyCard } from "./types";

export type PublishedPropertyFilters = {
  destination?: string;
  guests?: number;
  maxRate?: number;
  amenity?: string;
};

type PropertyRow = {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  locality: string | null;
  max_guests: number;
  destination: { name: string; slug: string } | null;
  rooms: { base_nightly_rate: number | string; currency_code: string; is_active: boolean }[] | null;
};

type MediaRow = {
  property_id: string;
  storage_path: string;
  alt_text: string | null;
  is_cover: boolean;
  sort_order: number;
};

type AmenityRow = {
  property_id: string;
  amenity: { name: string; slug: string } | { name: string; slug: string }[] | null;
};

type ReviewRow = {
  property_id: string;
  rating: number | string;
};

function first<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export async function listPublishedProperties(filters: PublishedPropertyFilters = {}): Promise<PropertyCard[]> {
  const supabase = await createClient();

  let query = supabase
    .from("properties")
    .select("id,slug,name,summary,locality,max_guests,destination:destinations!inner(name,slug),rooms(base_nightly_rate,currency_code,is_active)")
    .eq("status", "published")
    .eq("destination.is_active", true)
    .order("published_at", { ascending: false })
    .limit(48);

  const destination = normalize(filters.destination);
  if (filters.guests) {
    query = query.gte("max_guests", filters.guests);
  }

  const { data, error } = await query;

  if (error) throw new Error("Unable to load marketplace properties.");

  const properties = (data ?? []) as unknown as PropertyRow[];
  const propertyIds = properties.map((property) => property.id);
  const [mediaResult, amenitiesResult, reviewsResult] = propertyIds.length
    ? await Promise.all([
        supabase
          .from("property_media")
          .select("property_id,storage_path,alt_text,is_cover,sort_order")
          .in("property_id", propertyIds)
          .eq("kind", "image")
          .order("is_cover", { ascending: false })
          .order("sort_order", { ascending: true }),
        supabase
          .from("property_amenities")
          .select("property_id,amenity:amenities!inner(name,slug)")
          .in("property_id", propertyIds),
        supabase
          .from("reviews")
          .select("property_id,rating")
          .in("property_id", propertyIds)
          .eq("is_published", true),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];

  if (mediaResult.error || amenitiesResult.error || reviewsResult.error) {
    throw new Error("Unable to load marketplace property details.");
  }

  const mediaByProperty = new Map<string, MediaRow>();
  for (const media of (mediaResult.data ?? []) as unknown as MediaRow[]) {
    const current = mediaByProperty.get(media.property_id);
    if (!current || media.is_cover || media.sort_order < current.sort_order) {
      mediaByProperty.set(media.property_id, media);
    }
  }

  const amenitiesByProperty = new Map<string, { name: string; slug: string }[]>();
  for (const row of (amenitiesResult.data ?? []) as unknown as AmenityRow[]) {
    const amenity = first(row.amenity);
    if (!amenity) continue;
    const current = amenitiesByProperty.get(row.property_id) ?? [];
    current.push(amenity);
    amenitiesByProperty.set(row.property_id, current);
  }

  const reviewsByProperty = new Map<string, number[]>();
  for (const row of (reviewsResult.data ?? []) as unknown as ReviewRow[]) {
    const rating = Number(row.rating);
    if (!Number.isFinite(rating)) continue;
    const current = reviewsByProperty.get(row.property_id) ?? [];
    current.push(rating);
    reviewsByProperty.set(row.property_id, current);
  }

  const amenityFilter = normalize(filters.amenity);

  return properties.flatMap((property) => {
    const destinationRow = first(property.destination);
    if (destination) {
      const haystack = [
        property.name,
        property.locality,
        destinationRow?.name,
        destinationRow?.slug,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(destination)) return [];
    }

    const activeRooms = property.rooms?.filter((room) => room.is_active) ?? [];
    const rates = activeRooms.map((room) => Number(room.base_nightly_rate)).filter(Number.isFinite);
    const rate = rates.length ? Math.min(...rates) : 0;
    if (filters.maxRate !== undefined && rate > filters.maxRate) return [];

    const amenities = amenitiesByProperty.get(property.id) ?? [];
    if (amenityFilter && !amenities.some((amenity) => String(amenity.slug).toLowerCase() === amenityFilter)) return [];

    const reviewRatings = reviewsByProperty.get(property.id) ?? [];
    const media = mediaByProperty.get(property.id);
    return [{
      id: property.id,
      slug: property.slug,
      name: property.name,
      destination: destinationRow?.name ?? "Mizoram",
      destinationSlug: destinationRow?.slug ?? "mizoram",
      locality: property.locality,
      description: property.summary ?? "A locally hosted stay in Mizoram.",
      rate,
      currencyCode: activeRooms[0]?.currency_code ?? "INR",
      maxGuests: property.max_guests,
      rating: reviewRatings.length
        ? reviewRatings.reduce((total, rating) => total + rating, 0) / reviewRatings.length
        : 0,
      reviews: reviewRatings.length,
      verification: "Platform verified" as const,
      amenities: amenities.map((amenity) => amenity.name).slice(0, 4),
      coverImageUrl: media ? supabase.storage.from("property-media").getPublicUrl(media.storage_path).data.publicUrl : null,
      coverImageAlt: media?.alt_text ?? property.name,
    }];
  });
}
