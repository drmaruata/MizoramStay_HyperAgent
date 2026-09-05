import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { propertyDocumentCompleteSchema } from "@/lib/validation/property-update";

const BUCKET = "verification-documents";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = propertyDocumentCompleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid document completion request", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const input = parsed.data;
  const expectedPrefix = `${user.id}/${input.propertyId}/`;
  if (!input.path.startsWith(expectedPrefix) || input.path.slice(expectedPrefix.length).includes("/")) {
    return NextResponse.json({ error: "Document path does not belong to this host and property" }, { status: 403 });
  }

  const { data: property, error: propertyError } = await supabase
    .from("properties")
    .select("id")
    .eq("id", input.propertyId)
    .eq("host_id", user.id)
    .maybeSingle();
  if (propertyError) return NextResponse.json({ error: "Property lookup is temporarily unavailable" }, { status: 503 });
  if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const admin = createAdminClient();
  const objectName = input.path.slice(expectedPrefix.length);
  const { data: objects, error: objectError } = await admin.storage
    .from(BUCKET)
    .list(expectedPrefix.slice(0, -1), { search: objectName, limit: 100 });
  if (objectError) return NextResponse.json({ error: "Unable to verify the uploaded document" }, { status: 503 });

  const object = objects?.find((candidate) => candidate.name === objectName && candidate.id !== null);
  if (!object) return NextResponse.json({ error: "Uploaded document object was not found" }, { status: 422 });
  if (object.metadata?.mimetype !== input.contentType || object.metadata?.size !== input.fileSize) {
    return NextResponse.json({ error: "Uploaded document metadata does not match the completion request" }, { status: 422 });
  }

  const { data: existing, error: existingError } = await admin
    .from("property_documents")
    .select("id,property_id,document_type,storage_path,status,expires_on,created_at,updated_at")
    .eq("storage_path", input.path)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: "Unable to check document metadata" }, { status: 503 });
  if (existing) {
    if (existing.property_id !== input.propertyId) {
      return NextResponse.json({ error: "Document path is already assigned to another property" }, { status: 409 });
    }
    return NextResponse.json({ document: existing }, { status: 200 });
  }

  const { data: document, error: insertError } = await admin
    .from("property_documents")
    .insert({
      property_id: input.propertyId,
      document_type: input.documentType,
      storage_path: input.path,
      expires_on: input.expiresOn ?? null,
      status: "pending",
    })
    .select("id,property_id,document_type,storage_path,status,expires_on,created_at,updated_at")
    .single();

  if (insertError?.code === "23505") {
    const { data: raced } = await admin
      .from("property_documents")
      .select("id,property_id,document_type,storage_path,status,expires_on,created_at,updated_at")
      .eq("storage_path", input.path)
      .maybeSingle();
    if (raced?.property_id === input.propertyId) return NextResponse.json({ document: raced }, { status: 200 });
    return NextResponse.json({ error: "Document metadata conflicts with an existing record" }, { status: 409 });
  }
  if (insertError || !document) return NextResponse.json({ error: "Unable to save document metadata" }, { status: 503 });

  return NextResponse.json({ document }, { status: 201 });
}
