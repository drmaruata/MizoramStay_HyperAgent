import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getPublishedPropertyBySlug,
  PublicPropertyRepositoryError,
} from "@/features/properties/public-repository";

const slugSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Invalid property slug").max(120);

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const parsedSlug = slugSchema.safeParse(slug);

  if (!parsedSlug.success) {
    return NextResponse.json({ error: "Invalid property slug" }, { status: 400 });
  }

  try {
    const property = await getPublishedPropertyBySlug(parsedSlug.data);
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    return NextResponse.json({ data: property });
  } catch (error) {
    if (error instanceof PublicPropertyRepositoryError) {
      return NextResponse.json({ error: "Property is temporarily unavailable" }, { status: 503 });
    }

    return NextResponse.json({ error: "Property is temporarily unavailable" }, { status: 503 });
  }
}
