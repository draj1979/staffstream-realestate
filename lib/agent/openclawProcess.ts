import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..", "..");

export const openclawBin = path.join(repoRoot, "node_modules", ".bin", "openclaw");
export const TURN_TIMEOUT_SECONDS = 120;

// Observed shape of `openclaw agent --local --json`'s stdout (verified
// against openclaw 2026.7.1-2 — the CLI's own docs describe a differently
// -shaped { ok, status, final, ... } envelope, but that's not what this
// version actually prints). Success/failure is determined by the child
// process's exit code (see runOpenClawAgent), not a field in here.
interface OpenClawJsonEnvelope {
  payloads?: { text?: string | null; mediaUrl?: string | null }[];
  meta?: { agentMeta?: { sessionId?: string } };
}

/**
 * Spawns one `openclaw agent --local` turn and resolves with raw stdout
 * (the `--json` envelope). Shared by runTurn.ts (real inbound messages)
 * and followup.ts (system-triggered re-engagement messages) — both drive
 * a turn the same way, just with different trigger text and context.
 */
export function runOpenClawAgent(sessionId: string, message: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      openclawBin,
      ["agent", "--local", "--session-id", sessionId, "--message", message, "--json", "--timeout", String(TURN_TIMEOUT_SECONDS)],
      { env }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`openclaw agent exited with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}

/** Extracts the reply text from a `--json` envelope, throwing if there isn't one. */
export function parseOpenClawReply(stdout: string): string {
  const envelope: OpenClawJsonEnvelope = JSON.parse(stdout);
  const text = envelope.payloads?.[0]?.text;
  if (!text) {
    throw new Error(`OpenClaw agent turn returned no reply text: ${JSON.stringify(envelope)}`);
  }
  return text;
}
