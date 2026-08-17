import { mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const personaDir = path.join(moduleDir, "persona");
const repoRoot = path.resolve(moduleDir, "..", "..");

function workspaceRoot(): string {
  const configured = process.env.OPENCLAW_WORKSPACE_PATH;
  if (!configured) {
    throw new Error("OPENCLAW_WORKSPACE_PATH is not set (see .env.example).");
  }
  return path.resolve(repoRoot, configured);
}

export function sharedConfigPath(): string {
  return path.join(workspaceRoot(), "openclaw.json");
}

export function leadWorkspaceDir(leadId: string): string {
  return path.join(workspaceRoot(), "leads", leadId);
}

/**
 * Session/runtime state (OPENCLAW_STATE_DIR) isolated per lead too, so
 * concurrent conversations never share a session store — session
 * continuity itself is already guaranteed by a unique --session-id
 * regardless, this just avoids any shared mutable state at all.
 */
export function leadStateDir(leadId: string): string {
  return path.join(leadWorkspaceDir(leadId), ".state");
}

/**
 * Writes the shared, static openclaw.json: model config (Gemini, via a
 * secret reference to GEMINI_API_KEY, never hardcoded) and the MCP
 * server entry for our five tools (lib/agent/mcp-server.ts). Regenerated
 * on every call — it's fully derived from env/repo layout, nothing here
 * is meant to be hand-edited.
 */
export async function ensureSharedConfig(): Promise<string> {
  const root = workspaceRoot();
  await mkdir(root, { recursive: true });

  const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
  const mcpServerEntry = path.join(moduleDir, "mcp-server.ts");

  const config = {
    agents: {
      defaults: {
        // Verified against the installed OpenClaw's own model catalog
        // (`openclaw models list --all --provider google`) — see
        // lib/agent/README.md for the model-switch history.
        model: { primary: "google/gemini-3.1-flash-lite" },
      },
    },
    models: {
      providers: {
        // Secret reference, not a literal key — OpenClaw resolves this
        // from the GEMINI_API_KEY env var at runtime (GOOGLE_API_KEY is
        // also accepted by OpenClaw, but we standardize on one name).
        google: { apiKey: "${GEMINI_API_KEY}" },
      },
    },
    mcp: {
      servers: {
        staffstream: {
          command: tsxBin,
          args: [mcpServerEntry],
          // Best-effort explicit passthrough in case OpenClaw supports
          // ${VAR} substitution here; ordinary env inheritance is the
          // fallback either way — see lib/agent/README.md.
          env: {
            DATABASE_URL: "${DATABASE_URL}",
            STAFFSTREAM_TURN_EFFECTS_FILE: "${STAFFSTREAM_TURN_EFFECTS_FILE}",
          },
        },
      },
    },
  };

  const configPath = path.join(root, "openclaw.json");
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
  return configPath;
}

/**
 * Materializes this lead's own OpenClaw workspace directory: the static
 * persona files (copied from lib/agent/persona/, same content for every
 * lead) plus this lead's PROJECT_CONTEXT.md (rewritten every turn by
 * runTurn.ts via writeProjectContext). One workspace directory per lead
 * keeps concurrent conversations from racing on the same
 * PROJECT_CONTEXT.md file — see lib/agent/README.md.
 */
export async function ensureLeadWorkspace(leadId: string): Promise<string> {
  const dir = leadWorkspaceDir(leadId);
  await mkdir(dir, { recursive: true });

  for (const file of ["AGENTS.md", "SOUL.md", "IDENTITY.md"]) {
    await copyFile(path.join(personaDir, file), path.join(dir, file));
  }

  return dir;
}

export async function writeProjectContext(leadId: string, content: string): Promise<void> {
  const dir = leadWorkspaceDir(leadId);
  await writeFile(path.join(dir, "PROJECT_CONTEXT.md"), content, "utf8");
}
