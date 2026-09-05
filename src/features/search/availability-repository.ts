import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AvailabilitySearchInput } from "@/lib/validation/search";

export type AvailabilitySearchResult = {
  propertyId: string;
  slug: string;
  name: string;
  summary: string | null;
  maxGuests: number;
  destination: {
    slug: string;
    name: string;
    locality: string | null;
  };
  roomId: string;
  roomName: string;
  availableUnits: number;
  minTotalPrice: number;
  minNightlyPrice: number;
  currencyCode: string;
};

export class AvailabilityRepositoryError extends Error {
  constructor() {
    super("Availability search is temporarily unavailable.");
    this.name = "AvailabilityRepositoryError";
  }
}

type AvailabilityRow = {
  property_id: string;
  property_slug: string;
  property_name: string;
  summary: string | null;
  max_guests: number;
  destination_slug: string;
  destination_name: string;
  locality: string | null;
  room_id: string;
  room_name: string;
  available_units: number;
  min_total_price: number | string;
  min_nightly_price: number | string;
  currency_code: string;
};

export async function searchAvailableProperties(input: AvailabilitySearchInput): Promise<AvailabilitySearchResult[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_available_properties", {
    p_destination: input.destination,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_guest_count: input.guests,
    p_limit: input.limit,
  });

  if (error) throw new AvailabilityRepositoryError();

  return ((data ?? []) as unknown as AvailabilityRow[]).map((row) => {
    const minTotalPrice = Number(row.min_total_price);
    const minNightlyPrice = Number(row.min_nightly_price);

    if (!Number.isFinite(minTotalPrice) || !Number.isFinite(minNightlyPrice)) {
      throw new AvailabilityRepositoryError();
    }

    return {
      propertyId: row.property_id,
      slug: row.property_slug,
      name: row.property_name,
      summary: row.summary,
      maxGuests: row.max_guests,
      destination: {
        slug: row.destination_slug,
        name: row.destination_name,
        locality: row.locality,
      },
      roomId: row.room_id,
      roomName: row.room_name,
      availableUnits: row.available_units,
      minTotalPrice,
      minNightlyPrice,
      currencyCode: row.currency_code,
    };
  });
}
