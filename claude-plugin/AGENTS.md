---
title: claude-plugin — Claude Code hooks and skills
---

## Overview

Claude Code integration uses bash hooks plus JavaScript helpers and three skills. Hook scripts are small and deterministic; shared HTTP helpers live in `hooks/common.sh`.

## Where to look

| Task | File |
|------|------|
| Shared curl/env helpers | `hooks/common.sh` |
| Session-start bootstrap | `hooks/session-start.sh` |
| Prompt-time recall | `hooks/user-prompt-submit.sh` |
| Session stop capture | `hooks/stop.sh` |
| Pre-compact capture | `hooks/pre-compact.sh` |
| Session-end fallback | `hooks/session-end.sh` |
| Transcript parsing helper | `hooks/lib/transcript-parser.mjs` |
| Hook JSON helper | `hooks/lib/hook-json.mjs` |
| Memory block formatter | `hooks/lib/memories-formatter.mjs` |
| Shared skill auth/HTTP helpers | `lib/skill-auth.mjs` |
| Plugin manifest | `.claude-plugin/plugin.json` |
| Hook definitions | `hooks/hooks.json` |
| On-demand setup | `skills/setup/SKILL.md` |
| On-demand recall | `skills/recall/SKILL.md` |
| On-demand store | `skills/store/SKILL.md` |
| Memory management CLI | `skills/memory/scripts/memory.mjs` |
| Local state cleanup CLI | `skills/cleanup/scripts/cleanup.mjs` |

## Local conventions

- Every hook sources `hooks/common.sh`.
- JSON shaping should go through the `.mjs` helpers under `hooks/lib/`.
- Skill scripts import shared auth/HTTP helpers from `lib/skill-auth.mjs` (hooks use `hooks/common.sh` instead).
- Automatic recall and ingest go through `/v1alpha2/mem9s/...` with `X-API-Key` and `X-Mnemo-Agent-Id`.
- Runtime auth is stored in `${CLAUDE_PLUGIN_DATA}/auth.json`.
- Skill CLIs follow the codex-plugin shape: subcommands, `--help` text, exported parse/build functions for tests.
- `skills/memory/scripts/memory.mjs` covers the `/v1alpha2/mem9s` memory API surface; keep it aligned with `docs/api/openapi.json`.
- `skills/cleanup/scripts/cleanup.mjs` removes only known files under `${CLAUDE_PLUGIN_DATA}` and never deletes cloud data.

## Validation

- Validate hook scripts with `bash -n` and JavaScript helpers with `node --check`.
- Run `node --test tests/*.test.mjs` from this directory for skill script tests.
- Keep curl timeouts explicit (`--max-time 8`).

## Anti-patterns

- Do NOT add complex state to hooks.
- Do NOT assume marketplace install; manual install paths still matter.
- Do NOT use `jq` in hooks.
