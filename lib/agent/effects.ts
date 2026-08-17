import { appendFile, readFile, rm } from "node:fs/promises";
import type { ToolEffect } from "./types";

/**
 * Tool handlers run inside the MCP server subprocess that OpenClaw spawns —
 * a grandchild of our own process, not something runTurn.ts can observe
 * directly. To let runTurn.ts report *which* tools ran this turn (used for
 * the sendBrochure flag), tool handlers append a line to a per-turn JSONL
 * file whose path is threaded down via the STAFFSTREAM_TURN_EFFECTS_FILE
 * env var, which we set on the `openclaw` child process and assume
 * propagates to whatever it spawns (ordinary env inheritance).
 *
 * This is best-effort by design: every tool handler's actual database
 * writes happen unconditionally and don't depend on this file. If the env
 * var doesn't propagate for some reason, the only thing that degrades is
 * runTurn's sendBrochure flag — not correctness of the underlying data.
 */

const EFFECTS_FILE_ENV_VAR = "STAFFSTREAM_TURN_EFFECTS_FILE";

export function getEffectsFilePathFromEnv(): string | undefined {
  return process.env[EFFECTS_FILE_ENV_VAR];
}

export { EFFECTS_FILE_ENV_VAR };

export async function recordEffect(tool: string, args: unknown, result: unknown): Promise<void> {
  const filePath = getEffectsFilePathFromEnv();
  if (!filePath) return; // no-op outside a runTurn-managed invocation (e.g. direct tool tests)

  const line = JSON.stringify({ tool, args, result, at: new Date().toISOString() } satisfies ToolEffect);
  try {
    await appendFile(filePath, line + "\n", "utf8");
  } catch (err) {
    // Best-effort — never let effect logging break a tool call.
    console.error(`[agent/effects] failed to record effect for ${tool}:`, err);
  }
}

export async function readEffects(filePath: string): Promise<ToolEffect[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ToolEffect);
  } catch {
    return [];
  }
}

export async function cleanupEffectsFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}
