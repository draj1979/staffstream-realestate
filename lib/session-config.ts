import type { SessionOptions } from "iron-session";

// Shared between Route Handlers/Server Components (lib/session.ts) and
// middleware.ts. Kept free of `next/headers` so middleware (Edge runtime)
// can import it directly.

// The single builder admin's session. There's only one role for now, so all
// we need to track is which user (if any) is logged in.
export interface SessionData {
  userId?: string;
}

// Validated lazily (only when actually read, via the getter below), not
// at module-evaluation time — Next.js's build step imports route modules
// to collect page metadata without real env vars present, and a
// top-level throw here would fail `next build` regardless of whether any
// request ever actually needs a session.
function readSessionSecret(): string {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to a random string of at least 32 characters (see .env.example)."
    );
  }
  return sessionSecret;
}

export const sessionCookieName = "staffstream_session";

export const sessionOptions: SessionOptions = {
  get password() {
    return readSessionSecret();
  },
  cookieName: sessionCookieName,
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  },
};
