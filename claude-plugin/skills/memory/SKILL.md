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

1. Use `${CLAUDE_PLUGIN_DATA}/auth.json` only as request credentials. If auth is missing, tell the user to run `/mem9:setup` first. Do not print the file contents or the API key.
2. Run the bootstrap block below once, then run the curl command that matches the request.
3. Ask for confirmation before `delete` or `batch-delete`; show the ids (and a short content preview) that will be removed.
4. Summarize the JSON response for the user. Never reveal secret values.

## Bootstrap

```bash
set -euo pipefail

auth_file="${CLAUDE_PLUGIN_DATA}/auth.json"
test -f "$auth_file"
read_api_key_and_base_url="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const values=[data.api_key || "", data.base_url || "https://api.mem9.ai"]; process.stdout.write(values.join("\t"));' "$auth_file")"
api_key="${read_api_key_and_base_url%%	*}"
base_url="${read_api_key_and_base_url#*	}"
test -n "$api_key"
test -n "$base_url"
plugin_version="unknown"
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json" ]; then
  plugin_version="$(node -e 'const fs=require("node:fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.version || "unknown");' "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json")"
fi
```

## Commands

### Key status

```bash
curl -sf --max-time 8 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${api_key}" \
  -H "X-Mnemo-Agent-Id: claude-code" \
  -H "User-Agent: mem9-plugin/claude-code/${plugin_version}" \
  "${base_url%/}/v1alpha2/status"
```

### List or search memories

```bash
query='REPLACE_WITH_SEARCH_QUERY_OR_LEAVE_EMPTY_TO_LIST'
encoded_query="$(printf '%s' "$query" | node -e 'const fs=require("node:fs"); const raw=fs.readFileSync(0,"utf8").trim(); process.stdout.write(encodeURIComponent(raw));')"

curl -sf --max-time 8 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${api_key}" \
  -H "X-Mnemo-Agent-Id: claude-code" \
  -H "User-Agent: mem9-plugin/claude-code/${plugin_version}" \
  "${base_url%/}/v1alpha2/mem9s/memories?q=${encoded_query}&limit=20"
```

Optional filters, appended as extra query parameters (`&name=value`):

| Parameter | Values |
|---|---|
| `tags` | Comma-separated tag filter, e.g. `project,backend` |
| `source` | Memory source filter |
| `state` | `active`, `paused`, `archived`, `deleted` |
| `memory_type` | `pinned`, `insight`, `session` |
| `agent_id` | Agent filter. Omit to cover every agent in the account. |
| `session_id` | Session filter |
| `appId` | Application isolation filter |
| `sort_by` | `content`, `memory_type`, `tags`, `updated_at` (default) |
| `sort_dir` | `asc`, `desc` (default) |
| `search_mode` | `keyword` for direct substring matching |
| `offset` | Pagination offset |

`list` intentionally omits `agent_id` by default so every agent bucket in the account contributes,
matching automatic recall. Use `agent_id` only when the user asks to narrow to one agent.

### Get one memory

```bash
memory_id='REPLACE_WITH_MEMORY_ID'

curl -sf --max-time 8 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${api_key}" \
  -H "X-Mnemo-Agent-Id: claude-code" \
  -H "User-Agent: mem9-plugin/claude-code/${plugin_version}" \
  "${base_url%/}/v1alpha2/mem9s/memories/${memory_id}"
```

### Update one memory

Build the body with `node` so content is JSON-escaped. Include only the fields being replaced.

```bash
memory_id='REPLACE_WITH_MEMORY_ID'
new_content='REPLACE_WITH_NEW_CONTENT'

body="$(CONTENT="$new_content" node -e 'const payload={content:process.env.CONTENT}; process.stdout.write(JSON.stringify(payload));')"

curl -sf --max-time 8 -X PUT \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${api_key}" \
  -H "X-Mnemo-Agent-Id: claude-code" \
  -H "User-Agent: mem9-plugin/claude-code/${plugin_version}" \
  -d "$body" \
  "${base_url%/}/v1alpha2/mem9s/memories/${memory_id}"
```

To replace tags or metadata, build `{"tags":["a","b"]}` or `{"metadata":{...}}` the same way.
For optimistic updates, add `-H "If-Match: <version>"` using the memory's current `version`.

### Delete one memory

Succeeds with HTTP 204 and an empty body.

```bash
memory_id='REPLACE_WITH_MEMORY_ID'

curl -sf --max-time 8 -X DELETE \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${api_key}" \
  -H "X-Mnemo-Agent-Id: claude-code" \
  -H "User-Agent: mem9-plugin/claude-code/${plugin_version}" \
  "${base_url%/}/v1alpha2/mem9s/memories/${memory_id}"
```

### Delete multiple memories

```bash
body="$(node -e 'process.stdout.write(JSON.stringify({ids:process.argv.slice(1)}))' REPLACE_WITH_MEMORY_ID_1 REPLACE_WITH_MEMORY_ID_2)"

curl -sf --max-time 8 -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${api_key}" \
  -H "X-Mnemo-Agent-Id: claude-code" \
  -H "User-Agent: mem9-plugin/claude-code/${plugin_version}" \
  -d "$body" \
  "${base_url%/}/v1alpha2/mem9s/memories/batch-delete"
```

### Review raw session messages

List what Mem9 stored for one or more sessions. Repeat `session_id` per session;
`limit_per_session` (max 500) is optional.

```bash
session_id='REPLACE_WITH_SESSION_ID'

curl -sf --max-time 8 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${api_key}" \
  -H "X-Mnemo-Agent-Id: claude-code" \
  -H "User-Agent: mem9-plugin/claude-code/${plugin_version}" \
  "${base_url%/}/v1alpha2/mem9s/session-messages?session_id=${session_id}&limit_per_session=50"
```

## Notes

- Deleting is permanent for that memory id. Cloud deletions cannot be undone by this plugin.
- Deleting memories does not reset quota usage or billing counters.
- Never reveal secret values.
