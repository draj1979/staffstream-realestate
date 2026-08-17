import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { unsealData } from "iron-session";
import { sessionCookieName, sessionOptions } from "@/lib/session-config";
import type { SessionData } from "@/lib/session-config";

// Routes under /api/** that stay open even though the rest of /api/** is
// protected: the login endpoint itself, and inbound webhooks/cron jobs
// which authenticate a different way (signature/secret, not a session).
const PUBLIC_API_PREFIXES = ["/api/auth/login", "/api/webhooks", "/api/cron"];

async function isAuthenticated(request: NextRequest): Promise<boolean> {
  const cookie = request.cookies.get(sessionCookieName)?.value;
  if (!cookie) return false;

  try {
    const session = await unsealData<SessionData>(cookie, {
      password: sessionOptions.password,
    });
    return Boolean(session.userId);
  } catch {
    // Malformed/expired/tampered cookie — treat as unauthenticated.
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith("/api/");
  const isDashboardRoute = pathname.startsWith("/dashboard");

  if (isApiRoute && PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  if (!isApiRoute && !isDashboardRoute) {
    return NextResponse.next();
  }

  if (await isAuthenticated(request)) {
    return NextResponse.next();
  }

  if (isApiRoute) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
