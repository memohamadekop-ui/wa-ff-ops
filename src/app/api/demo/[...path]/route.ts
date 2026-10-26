import { jsonError } from "@/lib/http";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

type Context = { params: Promise<{ path: string[] }> };

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isAllowedRoute(method: string, path: string[]) {
  if (method === "GET") {
    return (
      (path.length === 2 && path[0] === "wa" && ["status", "conversations", "messages"].includes(path[1])) ||
      (path.length === 3 &&
        path[0] === "wa" &&
        path[1] === "messages" &&
        path[2] === "export") ||
      (path.length === 4 &&
        path[0] === "wa" &&
        path[1] === "conversations" &&
        /^[0-9a-f-]{36}$/i.test(path[2]) &&
        path[3] === "messages")
    );
  }
  return (
    method === "POST" &&
    path.length === 2 &&
    path[0] === "wa" &&
    ["connect", "disconnect", "sync"].includes(path[1])
  );
}

async function proxy(request: NextRequest, context: Context) {
  if (process.env.NODE_ENV !== "development") {
    return jsonError(404, "Not found");
  }

  const { path } = await context.params;
  const hostHeader = request.headers.get("host");
  let requestHost: URL;
  try {
    if (!hostHeader) return jsonError(404, "Not found");
    requestHost = new URL(`${request.nextUrl.protocol}//${hostHeader}`);
  } catch {
    return jsonError(404, "Not found");
  }
  if (
    !isLoopbackHost(requestHost.hostname) ||
    !isLoopbackHost(request.nextUrl.hostname) ||
    !isAllowedRoute(request.method, path)
  ) {
    return jsonError(404, "Not found");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return jsonError(403, "Forbidden");
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (
        !isLoopbackHost(originUrl.hostname) ||
        originUrl.host !== hostHeader
      ) {
        return jsonError(403, "Forbidden");
      }
    } catch {
      return jsonError(403, "Forbidden");
    }
  } else if (request.method === "POST") {
    return jsonError(403, "Forbidden");
  }

  const secret = process.env.OCC_BACKEND_SHARED_SECRET;
  if (!secret) {
    return jsonError(503, "OCC_BACKEND_SHARED_SECRET must be configured for the local demo");
  }

  const backendUrl = process.env.WA_BACKEND_INTERNAL_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
  const target = new URL(`/api/${path.map(encodeURIComponent).join("/")}`, backendUrl);
  target.search = request.nextUrl.search;

  try {
    const timeoutMs =
      path[0] === "wa" && path[1] === "sync"
        ? 300_000
        : path[2] === "export"
          ? 120_000
          : 20_000;
    const upstream = await fetch(target, {
      method: request.method,
      headers: { "x-occ-backend-secret": secret },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Local demo proxy request failed", {
      path: path.join("/"),
      reason: error instanceof Error ? error.message : "unknown error",
    });
    return jsonError(502, "Backend API is unavailable");
  }
}

export const GET = proxy;
export const POST = proxy;
