import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions } from "./session-config";
import type { SessionData } from "./session-config";

export { sessionOptions, sessionCookieName } from "./session-config";
export type { SessionData } from "./session-config";

/**
 * For use in Server Components, Server Actions, and Route Handlers where
 * `next/headers` cookies() is available. Middleware (Edge runtime) reads
 * the cookie directly and unseals it with iron-session's `unsealData`
 * instead — see middleware.ts.
 */
export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}
