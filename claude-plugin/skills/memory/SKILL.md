---
description: Use when the user asks to manage stored Mem9 memories — list, inspect, update, delete, batch delete, review session sources, or check API key status.
context: fork
allowed-tools:
  - Bash
  - Read
disable-model-invocation: true
---

# Mem9 Memory Management

Use this skill when the user asks to manage what Mem9 has already stored: browse or search saved
memories, inspect one memory, correct or update one, delete one or many, review the raw session
messages behind them, or check the current API key status.

This skill never stores new memories — use `/mem9:store` for that, or `/mem9:recall` to search
for context relevant to the current request.

## Steps

1. Resolve `./scripts/memory.mjs` relative to this skill directory.
2. If you need the current CLI surface, flags, or examples, run
   `node ./scripts/memory.mjs --help` first.
3. Use `${CLAUDE_PLUGIN_DATA}/auth.json` only as request credentials. If auth is missing, tell
   the user to run `/mem9:setup`. Do not print the file contents or the API key.
4. Map the user's request to one command. Ask for confirmation before `delete` or
   `batch-delete` and show the ids (and a short content preview) that will be removed.
5. Run the command:

```bash
set -euo pipefail
node ./scripts/memory.mjs REPLACE_WITH_COMMAND
```

## Commands

- `status` — show the API key status.
- `list` — list or search memories. Without `--q` it lists by filters.
  Examples: `list --q "release checklist" --limit 5`, `list --memory-type pinned`,
  `list --agent-id claude-code-main --state active`.
- `get <id>` — show one memory by id.
- `update <id> --content <text>` — replace a memory's content. Also supports
  `--tags <a,b>`, `--metadata <json>`, and `--if-match <version>` for optimistic updates.
- `delete <id>` — delete one memory.
- `batch-delete <id> [id ...]` — delete multiple memories in one request.
- `session-messages --session-id <id>` — list the raw session messages mem9 stored for one or
  more sessions (repeat `--session-id`), optionally with `--limit-per-session <count>`.

Common list filters: `--q`, `--tags`, `--source`, `--state`, `--memory-type`, `--agent-id`,
`--session-id`, `--app-id`, `--sort-by`, `--sort-dir`, `--search-mode keyword`, `--limit`,
`--offset`.

## Notes

- `list` intentionally omits `agent_id` by default so every agent bucket in the account
  contributes. Use `--agent-id` to narrow to one agent.
- Deleting is permanent for that memory id. Cloud deletions cannot be undone by this plugin.
- Deleting memories does not reset quota usage or billing counters.
- Do not print API keys or credential file contents.
- Summarize the JSON response for the user; do not dump secrets.
