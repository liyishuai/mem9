# Mem9 Claude Code Plugin

Persistent cloud memory for Claude Code.

## Install

Install from your terminal with the Claude Code CLI:

```text
claude plugin marketplace add mem9-ai/mem9
claude plugin install mem9@mem9
```

After installation, start a new Claude Code session. Mem9 will initialize automatically on `SessionStart(startup)`.

## Prerequisites

- Claude Code plugin support
- `Node.js 18+`
- Network access to `https://api.mem9.ai`

## Auth Model

The plugin stores its runtime API key cache in:

```text
${CLAUDE_PLUGIN_DATA}/auth.json
```

This file is a runtime auth cache stored in the Claude Code plugin data directory.
Claude Code may remove that directory when the plugin is removed from its last scope.

That file is auto-created on `SessionStart(startup)` when auth is missing.

The stored JSON looks like this:

```json
{
  "base_url": "https://api.mem9.ai",
  "api_key": "generated-api-key",
  "created_at": "2026-04-10T00:00:00.000Z",
  "source": "auto_provisioned"
}
```

## Hook Flow

```text
SessionStart(startup)
  -> check Node.js 18+
  -> create auth.json if missing

UserPromptSubmit
  -> GET /v1alpha2/mem9s/memories?q=...
  -> inject <relevant-memories>...</relevant-memories>

Stop
  -> parse transcript_path
  -> upload last turn as messages[]

PreCompact
  -> upload a larger recent window

SessionEnd
  -> upload a small best-effort final window
```

## API Contract

Automatic recall uses:

```text
GET /v1alpha2/mem9s/memories?q=<prompt>&limit=10
Headers:
  X-API-Key: <api_key>
  X-Mnemo-Agent-Id: claude-code
```

Recall intentionally omits `agent_id` so every agent bucket in the account (e.g. other plugins) contributes to the result set. Ingest still scopes writes by `agent_id` (see below).

Automatic transcript ingest uses:

```json
POST /v1alpha2/mem9s/memories
{
  "session_id": "claude-session-id",
  "agent_id": "claude-code-main",
  "mode": "smart",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

## Skills

The plugin exposes:

- `/mem9:setup`
- `/mem9:recall`
- `/mem9:store`
- `/mem9:memory`
- `/mem9:cleanup`

`/mem9:setup` is the backup path when auto-init did not complete.
It writes `${CLAUDE_PLUGIN_DATA}/auth.json` without printing the API key back to the user.

`/mem9:memory` manages what has already been stored. It wraps the `/v1alpha2/mem9s` API with
subcommands:

- `status` — show the API key status
- `list` — list or search memories with filters (`--q`, `--tags`, `--source`, `--state`,
  `--memory-type`, `--agent-id`, `--session-id`, `--app-id`, `--sort-by`, `--sort-dir`,
  `--search-mode`, `--limit`, `--offset`)
- `get <id>` — show one memory
- `update <id>` — replace `--content`, `--tags`, or `--metadata`, with optional
  `--if-match <version>` for optimistic updates
- `delete <id>` — delete one memory
- `batch-delete <id> [id ...]` — delete multiple memories in one request
- `session-messages --session-id <id>` — list the raw session messages stored for one or more
  sessions

`list` omits `agent_id` by default so every agent bucket in the account contributes, matching
automatic recall. Use `--agent-id` to narrow to one agent.

`/mem9:cleanup` removes mem9-managed local plugin state before reinstalling, resetting, or
uninstalling:

- `inspect` — print a JSON summary of removable targets
- `run` — remove `${CLAUDE_PLUGIN_DATA}/auth.json` and `${CLAUDE_PLUGIN_DATA}/runtime-notices.json`
- `run --include-logs` — also remove `${CLAUDE_PLUGIN_DATA}/logs/`

Cleanup never deletes cloud memories, quota usage, or billing state, and never prints the API
key. After `run`, the next session start auto-provisions a fresh API key.

## Uninstall

1. Run `/mem9:cleanup` to reset local plugin state.
2. Remove the plugin in Claude Code (`/plugin`), which also removes the plugin data directory.
3. Optional: delete cloud data first with `/mem9:memory batch-delete` if you want the stored
   memories gone too.

## Troubleshooting

If memory is not working:

1. Check that `node --version` is `>= 18`.
2. Check that `${CLAUDE_PLUGIN_DATA}/auth.json` exists.
3. Run `/mem9:setup`.
4. Restart Claude Code.

If `SessionStart` says Node is missing, install Node and restart Claude Code.

If recall fails, Claude continues normally. The plugin treats recall as best effort.

If `Stop` / `PreCompact` / `SessionEnd` fail, Claude still exits normally. The plugin treats ingest as best effort.

## Debug Logs

For real Claude Code troubleshooting, enable plugin debug logs with:

```bash
export MEM9_DEBUG=1
```

When enabled, the plugin writes JSONL logs to:

```text
${CLAUDE_PLUGIN_DATA}/logs/hooks.jsonl
```

The logs are designed for debugging hook flow without leaking secrets:

- They record hook name, stage, counts, auth source, and failure reason.
- They do not record API keys.
- They do not record full prompts or full transcript message content.
