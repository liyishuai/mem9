---
description: Use when the user asks to remove, reset, or clean up local mem9 Claude Code plugin state before reinstalling or uninstalling mem9.
context: fork
allowed-tools:
  - Bash
  - Read
disable-model-invocation: true
---

# Mem9 Cleanup

Use this skill when the user asks to remove mem9 from this Claude Code environment, reset the
local mem9 plugin state, or prepare a clean reinstall.

This skill removes **local plugin state only**. It never deletes cloud memories, quota usage,
or billing state. To delete stored memories, use `/mem9:memory` instead.

## Steps

1. Resolve `./scripts/cleanup.mjs` relative to this skill directory.
2. If you need the current CLI surface, flags, or examples, run
   `node ./scripts/cleanup.mjs --help` first.
3. Inspect the current cleanup targets first:

```bash
set -euo pipefail
node ./scripts/cleanup.mjs inspect
```

4. Use the JSON summary to confirm what exists. Ask the user whether debug logs should also be
   removed when `debug_logs` exists.
5. Remove the mem9-managed local files:

```bash
set -euo pipefail
node ./scripts/cleanup.mjs run
```

6. When the user also wants the debug logs removed, run:

```bash
set -euo pipefail
node ./scripts/cleanup.mjs run --include-logs
```

## What cleanup removes

`run` removes, inside `${CLAUDE_PLUGIN_DATA}` only:

- `auth.json` — the cached mem9 API key
- `runtime-notices.json` — runtime quota notice state

`run --include-logs` also removes:

- `logs/` — mem9 hook debug logs

## What cleanup keeps

- Cloud memories, quota usage, and billing state — not touched.
- The `${CLAUDE_PLUGIN_DATA}` directory itself — Claude Code owns it.
- Anything outside `${CLAUDE_PLUGIN_DATA}`.

## After cleanup

Tell the user:

- The next Claude Code session auto-provisions a fresh API key, unless the plugin is being
  uninstalled (Claude Code removes the plugin data directory on uninstall).
- Previous cloud memories stay under the old API key and are not reachable from the new one.
- To fully uninstall, also remove the plugin in Claude Code (`/plugin`) after cleanup.

Never print API keys or credential file contents.
