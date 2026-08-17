/**
 * Alerts the builder when something needs their attention (a site visit
 * got confirmed, a lead was handed off to a human). For now this logs
 * clearly instead of sending email — swap the body for a real
 * transactional email call (e.g. Resend) when ready; ADMIN_EMAIL is
 * already the configured recipient either way.
 *
 * Uses console.error (stderr), not console.log — this can run inside the
 * MCP tool server subprocess (lib/agent/mcp-server.ts), which reserves
 * stdout exclusively for MCP protocol JSON-RPC framing. Writing to stdout
 * there would corrupt the protocol stream. Cloud Logging captures stderr
 * the same as stdout, so this is still visible there.
 */
export function notifyBuilder(subject: string, details: Record<string, unknown>): void {
  console.error(`[ALERT] ${subject}`, JSON.stringify({ to: process.env.ADMIN_EMAIL, ...details }));
}
