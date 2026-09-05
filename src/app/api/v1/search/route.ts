import { NextResponse } from "next/server";
import {
  searchAvailableProperties,
  type AvailabilitySearchResult,
} from "@/features/search/availability-repository";
import { availabilitySearchSchema } from "@/lib/validation/search";

type SearchResponse = { data: AvailabilitySearchResult[] };

export async function GET(request: Request) {
  const params = availabilitySearchSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!params.success) {
    return NextResponse.json({ error: "Invalid search query" }, { status: 400 });
  }

  try {
    const data = await searchAvailableProperties(params.data);
    return NextResponse.json<SearchResponse>({ data });
  } catch {
    return NextResponse.json({ error: "Search temporarily unavailable" }, { status: 503 });
  }
}
