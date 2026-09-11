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

1. Check what currently exists:

```bash
set -euo pipefail

data_dir="${CLAUDE_PLUGIN_DATA}"
test -n "$data_dir"
for target in auth.json runtime-notices.json logs; do
  if [ -e "${data_dir}/${target}" ]; then
    printf 'exists: %s\n' "${data_dir}/${target}"
  else
    printf 'missing: %s\n' "${data_dir}/${target}"
  fi
done
```

2. Show the user what exists. Do not print file contents — `auth.json` holds the API key.
3. Remove the mem9-managed local files:

```bash
rm -f "${data_dir}/auth.json" "${data_dir}/runtime-notices.json"
```

4. When the user also wants the debug logs removed:

```bash
rm -rf "${data_dir}/logs"
```

## Scope

Removed, inside `${CLAUDE_PLUGIN_DATA}` only:

- `auth.json` — the cached mem9 API key
- `runtime-notices.json` — runtime quota notice state
- `logs/` — mem9 hook debug logs, only when the user asks

Kept:

- Cloud memories, quota usage, and billing state — not touched.
- The `${CLAUDE_PLUGIN_DATA}` directory itself and anything else in it — Claude Code owns it.

## After cleanup

Tell the user:

- The next Claude Code session auto-provisions a fresh API key, unless the plugin is being
  uninstalled (Claude Code removes the plugin data directory on uninstall).
- Previous cloud memories stay under the old API key and are not reachable from the new one.
- To fully uninstall, also remove the plugin in Claude Code (`/plugin`) after cleanup.

Never print API keys or credential file contents.
