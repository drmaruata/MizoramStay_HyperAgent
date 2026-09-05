import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const requestHostRoleSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  businessName: z.string().trim().min(1).max(200).optional(),
  taxIdentifier: z.string().trim().min(1).max(120).optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestHostRoleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid host profile request" }, { status: 400 });
  }

  // getUser verifies the bearer session with Supabase; do not trust decoded cookies or client-provided IDs.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { error: profileError } = await admin
    .from("profiles")
    .update({ role: "host" })
    .eq("id", user.id);

  if (profileError) {
    return NextResponse.json({ error: "Unable to enable hosting" }, { status: 503 });
  }

  const { error: hostProfileError } = await admin.from("host_profiles").upsert(
    {
      user_id: user.id,
      legal_name: parsed.data.legalName,
      business_name: parsed.data.businessName ?? null,
      tax_identifier: parsed.data.taxIdentifier ?? null,
    },
    { onConflict: "user_id" },
  );

  if (hostProfileError) {
    return NextResponse.json({ error: "Unable to save host profile" }, { status: 503 });
  }

  return NextResponse.json({ role: "host" }, { status: 200 });
}
