// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Supabase Edge Functions run under Deno and resolve the URL import below at deployment time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

function hasCronSecret(request: Request, expected: string) {
  const supplied = request.headers.get("x-cron-secret") ?? request.headers.get("cron-secret");
  if (!supplied || supplied.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  // This endpoint is scheduler-only. Its gateway JWT check is disabled because CRON_SECRET is
  // the caller credential; database mutation still uses and verifies the service role.
  if (request.headers.has("origin")) return new Response(null, { status: 403 });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const cronSecret = Deno.env.get("CRON_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!cronSecret || !supabaseUrl || !serviceRoleKey) {
    return json({ error: "Stay completion service is not configured" }, 503);
  }
  if (!hasCronSecret(request, cronSecret)) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("complete_departed_bookings");
  if (error) {
    console.error("Unable to complete departed bookings", { code: error.code });
    return json({ error: "Unable to complete departed bookings" }, 503);
  }

  if (typeof data !== "number" || !Number.isSafeInteger(data) || data < 0) {
    console.error("Stay completion RPC returned an invalid result");
    return json({ error: "Unable to verify completed bookings" }, 503);
  }

  return json({ completed: data });
});
