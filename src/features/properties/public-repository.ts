import "server-only";

import { createClient } from "@/lib/supabase/server";

export type PublicDestinationDto = {
  slug: string;
  name: string;
  state: string;
  countryCode: string;
  description: string | null;
};

export type PublicRoomDto = {
  id: string;
  name: string;
  description: string | null;
  capacityAdults: number;
  capacityChildren: number;
  bedsDescription: string | null;
  baseNightlyRate: number;
  currencyCode: string;
};

export type PublicMediaDto = {
  id: string;
  roomId: string | null;
  kind: "image" | "video";
  url: string;
  altText: string | null;
  sortOrder: number;
  isCover: boolean;
};

export type PublicAmenityDto = {
  slug: string;
  name: string;
  category: string;
  iconName: string | null;
};

export type PublicReviewDto = {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  hostResponse: string | null;
  createdAt: string;
};

export type PublicPropertyDto = {
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  checkInTime: string;
  checkOutTime: string;
  maxGuests: number;
  destination: PublicDestinationDto;
  rooms: PublicRoomDto[];
  media: PublicMediaDto[];
  amenities: PublicAmenityDto[];
  reviews: PublicReviewDto[];
};

export class PublicPropertyRepositoryError extends Error {
  constructor() {
    super("Unable to load the property.");
    this.name = "PublicPropertyRepositoryError";
  }
}

type PropertyRow = {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  check_in_time: string;
  check_out_time: string;
  max_guests: number;
  destination: {
    slug: string;
    name: string;
    state: string;
    country_code: string;
    description: string | null;
  } | null;
};

type RoomRow = {
  id: string;
  name: string;
  description: string | null;
  capacity_adults: number;
  capacity_children: number;
  beds_description: string | null;
  base_nightly_rate: number | string;
  currency_code: string;
};

type MediaRow = {
  id: string;
  room_id: string | null;
  kind: "image" | "video";
  storage_path: string;
  alt_text: string | null;
  sort_order: number;
  is_cover: boolean;
};

type AmenityRow = {
  amenity: {
    slug: string;
    name: string;
    category: string;
    icon_name: string | null;
  } | null;
};

type ReviewRow = {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  host_response: string | null;
  created_at: string;
};

/**
 * Retrieves only catalog fields that are safe for an unauthenticated property page.
 * The standard Supabase client deliberately preserves database RLS for every query.
 */
export async function getPublishedPropertyBySlug(slug: string): Promise<PublicPropertyDto | null> {
  const supabase = await createClient();
  const { data: propertyData, error: propertyError } = await supabase
    .from("properties")
    .select(
      "id,slug,name,summary,description,check_in_time,check_out_time,max_guests,destination:destinations!inner(slug,name,state,country_code,description)",
    )
    .eq("slug", slug)
    .eq("status", "published")
    .eq("destination.is_active", true)
    .maybeSingle();

  if (propertyError) throw new PublicPropertyRepositoryError();
  if (!propertyData) return null;

  const property = propertyData as unknown as PropertyRow;
  if (!property.destination) return null;

  const [roomsResult, mediaResult, amenitiesResult, reviewsResult] = await Promise.all([
    supabase
      .from("rooms")
      .select("id,name,description,capacity_adults,capacity_children,beds_description,base_nightly_rate,currency_code")
      .eq("property_id", property.id)
      .eq("is_active", true)
      .order("base_nightly_rate", { ascending: true }),
    supabase
      .from("property_media")
      .select("id,room_id,kind,storage_path,alt_text,sort_order,is_cover")
      .eq("property_id", property.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("property_amenities")
      .select("amenity:amenities!inner(slug,name,category,icon_name)")
      .eq("property_id", property.id),
    supabase
      .from("reviews")
      .select("id,rating,title,body,host_response,created_at")
      .eq("property_id", property.id)
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (roomsResult.error || mediaResult.error || amenitiesResult.error || reviewsResult.error) {
    throw new PublicPropertyRepositoryError();
  }

  const rooms = (roomsResult.data ?? []) as unknown as RoomRow[];
  const media = (mediaResult.data ?? []) as unknown as MediaRow[];
  const amenities = (amenitiesResult.data ?? []) as unknown as AmenityRow[];
  const reviews = (reviewsResult.data ?? []) as unknown as ReviewRow[];

  return {
    slug: property.slug,
    name: property.name,
    summary: property.summary,
    description: property.description,
    checkInTime: property.check_in_time,
    checkOutTime: property.check_out_time,
    maxGuests: property.max_guests,
    destination: {
      slug: property.destination.slug,
      name: property.destination.name,
      state: property.destination.state,
      countryCode: property.destination.country_code,
      description: property.destination.description,
    },
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      description: room.description,
      capacityAdults: room.capacity_adults,
      capacityChildren: room.capacity_children,
      bedsDescription: room.beds_description,
      baseNightlyRate: Number(room.base_nightly_rate),
      currencyCode: room.currency_code,
    })),
    media: media.map((item) => ({
      id: item.id,
      roomId: item.room_id,
      kind: item.kind,
      url: supabase.storage.from("property-media").getPublicUrl(item.storage_path).data.publicUrl,
      altText: item.alt_text,
      sortOrder: item.sort_order,
      isCover: item.is_cover,
    })),
    amenities: amenities.flatMap(({ amenity }) =>
      amenity
        ? [{ slug: amenity.slug, name: amenity.name, category: amenity.category, iconName: amenity.icon_name }]
        : [],
    ),
    reviews: reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      title: review.title,
      body: review.body,
      hostResponse: review.host_response,
      createdAt: review.created_at,
    })),
  };
}
