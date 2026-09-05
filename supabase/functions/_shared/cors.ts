// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
// Edge Functions run on Deno; this file is intentionally excluded from Next's Node type environment.
const configuredOrigin = Deno.env.get("APP_ORIGIN") ?? Deno.env.get("NEXT_PUBLIC_APP_URL");

function appOrigin() {
  if (!configuredOrigin) return null;

  try {
    return new URL(configuredOrigin).origin;
  } catch {
    return null;
  }
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  const allowedOrigin = appOrigin();

  if (!origin || !allowedOrigin || origin !== allowedOrigin) return {};

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function isAllowedCorsOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && appOrigin() === origin);
}
