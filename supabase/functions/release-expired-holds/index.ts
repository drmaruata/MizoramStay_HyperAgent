// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Supabase Edge Functions run under Deno and resolve the URL imports below at deployment time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, isAllowedCorsOrigin } from "../_shared/cors.ts";

function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
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
  if (request.method === "OPTIONS") {
    return isAllowedCorsOrigin(request)
      ? new Response(null, { status: 204, headers: corsHeaders(request) })
      : new Response(null, { status: 403 });
  }
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  if (request.headers.has("origin") && !isAllowedCorsOrigin(request)) return new Response(null, { status: 403 });

  const cronSecret = Deno.env.get("CRON_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!cronSecret || !supabaseUrl || !serviceRoleKey) {
    return json(request, { error: "Hold release service is not configured" }, 503);
  }
  if (!hasCronSecret(request, cronSecret)) return json(request, { error: "Unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("release_expired_holds");
  if (error) {
    console.error("Unable to release expired booking holds", { code: error.code });
    return json(request, { error: "Unable to release expired holds" }, 503);
  }

  const released = typeof data === "number"
    ? data
    : Array.isArray(data)
    ? data.length
    : typeof data?.released === "number"
    ? data.released
    : 0;
  return json(request, { released });
});
