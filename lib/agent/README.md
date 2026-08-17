# Agent module — how it's wired to OpenClaw

This module drives the WhatsApp sales agent's conversation logic on top of
OpenClaw. It is intentionally standalone/testable — nothing in here is
WhatsApp-specific. See [`runTurn.ts`](./runTurn.ts) for the entry point and
[`../../scripts/test-agent-turn.ts`](../../scripts/test-agent-turn.ts) for a
runnable sanity check.

## Step 0: how we actually integrate with OpenClaw, and why

We evaluated three ways to drive an OpenClaw agent turn from our own
Next.js app, checked against OpenClaw `2026.7.1-2` (the version installed
here — `openclaw` in `package.json`) and its docs at docs.openclaw.ai:

**1. A dedicated `@openclaw/agent-core` npm package — doesn't exist.**
`npm view @openclaw/agent-core` 404s; there's no such package on the
registry. The docs' references to "`@openclaw/agent-core`" turn out to
describe the `openclaw` package's own `./plugin-sdk/agent-core` subpath
export, not a separate library.

**2. That `plugin-sdk` subpath directly — exists, but isn't the right
tool for this job.** `openclaw/dist/plugin-sdk/agent-core.d.ts` does
re-export low-level primitives (`agentLoop`, `runAgentLoop`, `Session`,
`InMemorySessionStorage`, etc.), confirming a real "agent core" exists
inside the package. But the whole `plugin-sdk` surface — `ChannelPlugin`,
`OpenClawPluginApi`, `PluginRuntime`, `ChannelGatewayContext`, and so on —
is built for authoring plugins that get *loaded by* a running OpenClaw
Gateway/embedded-runtime instance, which supplies most of that context at
runtime. It is not documented, and not designed, as a standalone SDK for
an unrelated host process to import cold and drive a turn with zero
OpenClaw runtime involved. Wiring straight into it would mean depending on
internal, undocumented, minified (Rollup-renamed) types with no stated
compatibility guarantees.

**3. `openclaw agent --local` — a real, documented, stable one-shot
entry point. This is what we use.** OpenClaw's CLI ships a command built
for exactly this: running one agent turn programmatically without a
persistent Gateway daemon.

```
openclaw agent --local --session-id <id> --message <text> --json --timeout <seconds>
```

- `--local` runs the **embedded runtime** in-process within that CLI
  invocation — no Gateway process to stand up or supervise. OpenClaw's own
  docs note each `--local` run "does not leave local child processes
  running" once it completes.
- `--local` still preloads the plugin/MCP registry, so tools registered
  via `mcp.servers` (see below) are available.
- `--session-id <id>` targets a persistent session; reusing the same id
  across invocations keeps conversation history and state — this is how
  we get "one OpenClaw session per Lead" (§ Sessions below).
- `--json` returns a structured envelope (`{ ok, status, final, sessionId,
  usage, ... }`) instead of free-form stdout, so we can parse the reply
  reliably.

So: `runTurn()` spawns `openclaw agent --local ...` as a short-lived child
process per turn, from inside the Next.js API route that calls it. This
**avoids the sidecar-process/supervisor problem** the task called out for
Phase 8 — there is no long-running OpenClaw process to keep alive
alongside the Next.js server in the container; each turn is a normal
subprocess call that starts, runs, and exits, same shape as e.g. spawning
`ffmpeg` or any other CLI tool from a request handler. `Dockerfile`/Cloud
Run setup just needs the `openclaw` CLI on `PATH` (it's a normal npm
dependency, already in `node_modules/.bin`) — no second process to
supervise.

If a future OpenClaw version changes this (e.g. `--local` stops being
one-shot, or gets deprecated in favor of something else), the mitigation
is straightforward: `runTurn.ts`'s only OpenClaw-specific code is
`runOpenClawAgent()` at the bottom of the file — everything else (loading
context, persisting messages, tool logic) is unaffected by how we drive
the actual turn.

## How custom tools are registered: MCP

OpenClaw's own docs distinguish two extension mechanisms: **skills**
("change how the agent thinks, not what it can reach") and **MCP
integrations** ("add actual tool calls — read from a database, post to
Slack, create a GitHub issue"). Our five tools
(`update_lead_info`/`propose_site_visit`/`confirm_site_visit`/
`request_brochure`/`handoff_to_human`) are squarely the latter — they read
and write our Prisma database — so we register them as an MCP server,
configured under `mcp.servers` in the generated `openclaw.json`:

```json5
{
  mcp: {
    servers: {
      staffstream: {
        command: "<repo>/node_modules/.bin/tsx",
        args: ["<repo>/lib/agent/mcp-server.ts"],
      },
    },
  },
}
```

[`mcp-server.ts`](./mcp-server.ts) is a standalone stdio MCP server (using
`@modelcontextprotocol/sdk`) that OpenClaw spawns as a subprocess per that
config. It registers the same five tool handlers defined in
[`tools.ts`](./tools.ts) — those handlers are plain, directly-callable
async functions (see them exercised with no MCP/OpenClaw involved in
`tools.test`-style usage), and `mcp-server.ts` is a thin wrapper that adds
Zod input schemas and MCP framing around them.

Because it's spawned as its own OS process, `mcp-server.ts` has its own
Prisma client/connection — a second, lightweight connection to the same
database, not a shared client with the main Next.js server. That's a
deliberate, acceptable simplification for this MVP's traffic volume.

## Threading `leadId` into tool calls

Tool-call arguments come from the model, and `leadId` is an opaque
internal id the model has no organic reason to know. We could thread it
through `mcp.servers.staffstream.env` instead (see below — `${VAR}`
substitution there is confirmed working), but that would mean baking one
fixed `leadId` into the shared config rather than the per-invocation value
each turn actually needs. So instead every tool's schema requires
`leadId` as an explicit argument, and the per-turn Project Context (see
next section) tells the model, repeatedly and explicitly, to pass the
exact given `leadId` verbatim on every tool call. This is a common,
reliable pattern for threading a session token through tool calls.

## Per-session context: workspace-per-lead, not static persona files

The static persona files (`AGENTS.md`/`SOUL.md`/`IDENTITY.md` — see
`persona/`) define the agent's fixed operating instructions and voice,
same for every conversation. The brochure text and the lead's captured
requirement fields are **not** static — they differ per lead and change
turn to turn — so they can't live in those files.

OpenClaw's own docs describe workspace bootstrap files as being injected
under a "Project Context" section of the system prompt, assembled fresh
at the start of every session/run. We use exactly that mechanism, with one
wrinkle: bootstrap files are workspace-wide, and if every lead shared one
workspace, two conversations running concurrently could race on
overwriting the same `PROJECT_CONTEXT.md`. So each **lead** gets its own
OpenClaw workspace directory:

```
${OPENCLAW_WORKSPACE_PATH}/
  openclaw.json              # shared static config: model + mcp.servers
  leads/
    <leadId>/
      AGENTS.md               # copied from lib/agent/persona/ (static, shared content)
      SOUL.md
      IDENTITY.md
      PROJECT_CONTEXT.md      # rewritten by runTurn.ts before every turn
      .state/                 # OPENCLAW_STATE_DIR — this lead's session state
```

Before every turn, `runTurn.ts` (via `workspace.ts`) rewrites that lead's
`PROJECT_CONTEXT.md` with the current brochure text, the lead's captured
fields so far, whether this is their first message, and the `leadId`
instruction described above — then invokes `openclaw agent --local` with
`OPENCLAW_WORKSPACE_DIR` pointed at that lead's directory. Since each
`--local` run is a fresh one-shot process that reads the workspace from
disk at startup anyway, "rewrite the file, then invoke" is a natural fit
with no caching/staleness concerns.

`OPENCLAW_CONFIG_PATH` (model + `mcp.servers` config) and
`OPENCLAW_STATE_DIR` (session/runtime state) are also set explicitly per
invocation, both rooted under `OPENCLAW_WORKSPACE_PATH` rather than the
default `~/.openclaw` — this keeps the whole setup self-contained and
reproducible for the Phase 8 container (bake or mount one directory,
nothing touches the host's home directory), and gives each lead fully
isolated session state as a bonus (session continuity is already
guaranteed by the unique `--session-id`, so this isn't load-bearing, just
extra safety margin).

## Sessions

One OpenClaw session per Lead: `--session-id <leadId>`. Reusing the same
session id across calls to `runTurn()` for the same lead is what makes
OpenClaw remember prior turns (verified in `scripts/test-agent-turn.ts` —
turn 2 doesn't re-ask something turn 1 already established).

## Reporting which tools ran ("tool effects")

Tool execution happens inside the MCP server subprocess — a *grandchild*
of the process running `runTurn.ts`, not something it can observe
directly. Every tool handler's actual database writes (the durable,
load-bearing part) happen unconditionally inside `tools.ts`, regardless of
whether `runTurn.ts` "knows" about them. For the one thing that isn't
otherwise visible from the database — whether `request_brochure` was
called this turn, so the caller knows to send the PDF — tool handlers
append a line to a small per-turn JSONL file (`lib/agent/effects.ts`),
whose path is threaded down via the `STAFFSTREAM_TURN_EFFECTS_FILE` env
var, propagated through to the MCP subprocess via
`mcp.servers.staffstream.env` in `openclaw.json` (see `workspace.ts`) —
`${VAR}` substitution there is confirmed working: `openclaw config
validate` resolves it from the parent process's environment and reports
"Config valid" (verified locally; see the file's history/commit for the
check). This is still treated as best-effort in code (wrapped so a write
failure can't break a tool call) as defense in depth — if it ever did
fail, the only thing that degrades is the `sendBrochure` flag on
`runTurn()`'s return value, not the correctness of any Lead/SiteVisit
state, which tool handlers write directly regardless.

## Model configuration

`agents.defaults.model.primary` is set to `google/gemini-3.1-flash-lite`
(originally `anthropic/claude-sonnet-5` through Phases 4–10; switched on
direct request — the model key was verified against the installed
OpenClaw's own catalog via `openclaw models list --all --provider google`,
not just external docs, before making the change). Override via
`OPENCLAW_WORKSPACE_PATH`'s generated `openclaw.json` or `--model` if it
needs to change again. The API key is never hardcoded —
`models.providers.google.apiKey` is set to the literal string
`"${GEMINI_API_KEY}"`, OpenClaw's documented secret-reference syntax for
resolving a value from an environment variable at runtime (`GOOGLE_API_KEY`
is also accepted by OpenClaw; we standardize on `GEMINI_API_KEY`).
`--local` additionally expects the key to be present in the spawned
process's environment directly, which `runTurn.ts` also sets.

Switching models again in the future just means: confirm the new model
key against `openclaw models list --all --provider <id>` (don't trust
outside docs alone — they lag), update the `model.primary` and
`models.providers.<id>.apiKey` lines in `workspace.ts`, add the new
provider's API key to `.env.example`/Secret Manager, and re-run
`scripts/test-agent-turn.ts` before deploying.

## Files

| File | Purpose |
|---|---|
| `persona/AGENTS.md`, `SOUL.md`, `IDENTITY.md` | Static bootstrap files, source-controlled here, copied into each lead's workspace |
| `context.ts` | Builds the per-turn `PROJECT_CONTEXT.md` content |
| `workspace.ts` | Materializes the shared `openclaw.json` and each lead's workspace directory |
| `tools.ts` | The five tool handlers — plain, Prisma-backed, directly testable |
| `mcp-server.ts` | Stdio MCP server wrapping `tools.ts` for OpenClaw to call |
| `effects.ts` | Best-effort cross-process signal for which tools ran this turn |
| `runTurn.ts` | Main entry point — see its doc comment |
| `types.ts` | Shared types |
