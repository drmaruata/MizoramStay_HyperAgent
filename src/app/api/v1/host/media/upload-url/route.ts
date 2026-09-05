import { NextResponse } from "next/server";
import { propertyMediaUploadSchema } from "@/lib/validation/upload";
import { createClient } from "@/lib/supabase/server";

const mediaExtensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = propertyMediaUploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid media upload request", details: parsed.error.flatten() }, { status: 400 });
  }

  // getUser verifies the Supabase session; do not trust a client-provided user ID.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // This query is executed with the user's session, so RLS remains in force in
  // addition to the explicit ownership predicate.
  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("id")
    .eq("id", parsed.data.propertyId)
    .eq("host_id", user.id)
    .maybeSingle();

  if (propertyError) {
    return NextResponse.json({ error: "Property lookup is temporarily unavailable" }, { status: 503 });
  }
  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const extension = mediaExtensions[parsed.data.contentType];
  const path = `${user.id}/${property.id}/${crypto.randomUUID()}.${extension}`;
  const { data, error } = await supabase.storage
    .from("property-media")
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data) {
    return NextResponse.json({ error: "Unable to prepare media upload" }, { status: 503 });
  }

  return NextResponse.json({
    bucket: "property-media",
    path: data.path,
    signedUrl: data.signedUrl,
    token: data.token,
  });
}
