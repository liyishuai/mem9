#!/usr/bin/env node
// @ts-nocheck
// memory.mjs - Manage stored mem9 memories: list, get, update, delete, batch-delete,
// session source review, and API key status. Targets the /v1alpha2/mem9s API.

import { pathToFileURL } from "node:url";

import {
  Mem9HttpError,
  Mem9SkillAuthError,
  buildMem9Url,
  mem9FetchJson,
  mem9Headers,
  resolveSkillAuth,
} from "../../../lib/skill-auth.mjs";

const DEFAULT_LIMIT = 20;
const DEFAULT_WRITER_ID = "claude-code";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isHelpToken(token) {
  const normalized = normalizeString(token);
  return normalized === "--help" || normalized === "-h";
}

function shouldWriteHelp(argv = process.argv.slice(2)) {
  const tokens = Array.isArray(argv)
    ? argv.map((token) => normalizeString(token)).filter(Boolean)
    : [];
  if (tokens.length === 0 || tokens.some(isHelpToken)) {
    return true;
  }
  return isHelpToken(tokens[0]);
}

function buildHelpText() {
  return [
    "mem9 memory",
    "",
    "Manage stored mem9 memories through the /v1alpha2/mem9s API.",
    "",
    "Usage:",
    "  node ./scripts/memory.mjs <command> [flags]",
    "",
    "Commands:",
    "  status                                        Show API key status.",
    "  list [--q <query>] [filters]                  List or search memories.",
    "  get <id>                                      Show one memory by id.",
    "  update <id> [--content <text>] [fields]       Update one memory.",
    "  delete <id>                                   Delete one memory by id.",
    "  batch-delete <id> [id ...]                    Delete multiple memories.",
    "  session-messages --session-id <id>            List raw session messages.",
    "",
    "list filters:",
    "  --q <query>          Natural-language search query. Omit to list by filters.",
    "  --tags <a,b>         Comma-separated tag filter.",
    "  --source <source>    Memory source filter.",
    "  --state <state>      active, paused, archived, or deleted.",
    "  --memory-type <type> pinned, insight, or session.",
    "  --agent-id <id>      Filter by agent. Omit to cover every agent in the account.",
    "  --session-id <id>    Filter by session.",
    "  --app-id <id>        Filter by application isolation id.",
    "  --sort-by <field>    content, memory_type, tags, or updated_at (default).",
    "  --sort-dir <dir>     asc or desc (default).",
    "  --search-mode <mode> Set keyword for direct substring matching.",
    "  --limit <count>      Max memories to return. Defaults to 20, max 200.",
    "  --offset <count>     Pagination offset.",
    "",
    "update fields:",
    "  --content <text>     Replacement memory content.",
    "  --tags <a,b>         Replacement comma-separated tags.",
    "  --metadata <json>    Replacement metadata JSON object.",
    "  --if-match <version> Expected memory version for optimistic update.",
    "",
    "session-messages flags:",
    "  --session-id <id>    Session id. Repeatable.",
    "  --limit-per-session <count> Max messages per session.",
    "",
    "Flags:",
    "  --timeout-ms <ms>    Request timeout. Defaults to 15000.",
    "",
    "Notes:",
    "  - Successful commands print the raw API JSON response on stdout.",
    "  - Credentials come from MEM9_API_KEY or ${CLAUDE_PLUGIN_DATA}/auth.json.",
    "  - Do not print API keys or credential file contents.",
    "",
    "Examples:",
    "  node ./scripts/memory.mjs list --q 'release checklist' --limit 5",
    "  node ./scripts/memory.mjs get 0199aaaa-bbbb-cccc-dddd-eeeeffff0000",
    "  node ./scripts/memory.mjs update 0199aaaa-bbbb-cccc-dddd-eeeeffff0000 --content 'Updated fact'",
    "  node ./scripts/memory.mjs delete 0199aaaa-bbbb-cccc-dddd-eeeeffff0000",
    "  node ./scripts/memory.mjs batch-delete 0199aaaa-bbbb-cccc-dddd-eeeeffff0000 0199aaaa-bbbb-cccc-dddd-eeeeffff0001",
    "",
  ].join("\n");
}

function parsePositiveIntegerArg(flag, value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeIntegerArg(flag, value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

function parseTagsValue(flag, value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`${flag} must not be empty.`);
  }
  return normalized
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseMetadataValue(value) {
  const parsed = JSON.parse(value);
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--metadata must be a JSON object.");
  }
  return parsed;
}

const KNOWN_COMMANDS = [
  "status",
  "list",
  "get",
  "update",
  "delete",
  "batch-delete",
  "session-messages",
];

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    command: "",
    id: "",
    ids: [],
    sessionIds: [],
    q: "",
    tags: null,
    source: "",
    state: "",
    memoryType: "",
    agentId: "",
    sessionId: "",
    appId: "",
    sortBy: "",
    sortDir: "",
    searchMode: "",
    limit: DEFAULT_LIMIT,
    offset: 0,
    content: "",
    metadata: null,
    ifMatch: 0,
    limitPerSession: 0,
    timeoutMs: 15000,
  };

  const tokens = Array.isArray(argv) ? argv : [];
  if (tokens.length === 0) {
    return args;
  }

  args.command = normalizeString(tokens[0]);
  if (!KNOWN_COMMANDS.includes(args.command)) {
    throw new Error(
      `Unknown command: ${args.command || "(none)"}. Run with --help for usage.`,
    );
  }
  const positional = [];

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const nextValue = tokens[index + 1];

    switch (token) {
      case "--q":
        args.q = normalizeString(nextValue);
        index += 1;
        break;
      case "--tags":
        args.tags = parseTagsValue(token, nextValue);
        index += 1;
        break;
      case "--source":
        args.source = normalizeString(nextValue);
        index += 1;
        break;
      case "--state":
        args.state = normalizeString(nextValue);
        index += 1;
        break;
      case "--memory-type":
        args.memoryType = normalizeString(nextValue);
        index += 1;
        break;
      case "--agent-id":
        args.agentId = normalizeString(nextValue);
        index += 1;
        break;
      case "--session-id":
        if (args.command === "session-messages") {
          const sessionId = normalizeString(nextValue);
          if (sessionId) {
            args.sessionIds.push(sessionId);
          }
        } else {
          args.sessionId = normalizeString(nextValue);
        }
        index += 1;
        break;
      case "--app-id":
        args.appId = normalizeString(nextValue);
        index += 1;
        break;
      case "--sort-by":
        args.sortBy = normalizeString(nextValue);
        index += 1;
        break;
      case "--sort-dir":
        args.sortDir = normalizeString(nextValue);
        index += 1;
        break;
      case "--search-mode":
        args.searchMode = normalizeString(nextValue);
        index += 1;
        break;
      case "--limit":
        args.limit = parsePositiveIntegerArg(token, nextValue);
        index += 1;
        break;
      case "--offset":
        args.offset = parseNonNegativeIntegerArg(token, nextValue);
        index += 1;
        break;
      case "--content":
        args.content = typeof nextValue === "string" ? nextValue.trim() : "";
        index += 1;
        break;
      case "--metadata":
        args.metadata = parseMetadataValue(nextValue);
        index += 1;
        break;
      case "--if-match":
        args.ifMatch = parsePositiveIntegerArg(token, nextValue);
        index += 1;
        break;
      case "--limit-per-session":
        args.limitPerSession = parsePositiveIntegerArg(token, nextValue);
        index += 1;
        break;
      case "--timeout-ms":
        args.timeoutMs = parsePositiveIntegerArg(token, nextValue);
        index += 1;
        break;
      default:
        if (token.startsWith("--")) {
          throw new Error(`Unknown argument: ${token}`);
        }
        positional.push(token);
        break;
    }
  }

  if (args.command === "get" || args.command === "delete") {
    if (positional.length !== 1) {
      throw new Error(`${args.command} requires exactly one memory id.`);
    }
    args.id = positional[0];
  } else if (args.command === "update") {
    if (positional.length !== 1) {
      throw new Error("update requires exactly one memory id.");
    }
    args.id = positional[0];
  } else if (args.command === "batch-delete") {
    if (positional.length === 0) {
      throw new Error("batch-delete requires at least one memory id.");
    }
    args.ids = positional;
  }

  return args;
}

export function buildListUrl(baseUrl, args) {
  const url = buildMem9Url(baseUrl, "v1alpha2/mem9s/memories");
  if (args.q) {
    url.searchParams.set("q", args.q);
  }
  if (Array.isArray(args.tags) && args.tags.length > 0) {
    url.searchParams.set("tags", args.tags.join(","));
  }
  if (args.source) {
    url.searchParams.set("source", args.source);
  }
  if (args.state) {
    url.searchParams.set("state", args.state);
  }
  if (args.memoryType) {
    url.searchParams.set("memory_type", args.memoryType);
  }
  if (args.agentId) {
    url.searchParams.set("agent_id", args.agentId);
  }
  if (args.sessionId) {
    url.searchParams.set("session_id", args.sessionId);
  }
  if (args.appId) {
    url.searchParams.set("appId", args.appId);
  }
  if (args.sortBy) {
    url.searchParams.set("sort_by", args.sortBy);
  }
  if (args.sortDir) {
    url.searchParams.set("sort_dir", args.sortDir);
  }
  if (args.searchMode) {
    url.searchParams.set("search_mode", args.searchMode);
  }
  url.searchParams.set("limit", String(args.limit));
  if (args.offset > 0) {
    url.searchParams.set("offset", String(args.offset));
  }
  return url.toString();
}

export function buildSessionMessagesUrl(baseUrl, args) {
  if (args.sessionIds.length === 0) {
    throw new Error("session-messages requires at least one --session-id.");
  }
  const url = buildMem9Url(baseUrl, "v1alpha2/mem9s/session-messages");
  for (const sessionId of args.sessionIds) {
    url.searchParams.append("session_id", sessionId);
  }
  if (args.appId) {
    url.searchParams.set("appId", args.appId);
  }
  if (args.limitPerSession > 0) {
    url.searchParams.set("limit_per_session", String(args.limitPerSession));
  }
  return url.toString();
}

export function buildUpdateBody(args) {
  const body = {};
  if (args.content) {
    body.content = args.content;
  }
  if (Array.isArray(args.tags)) {
    body.tags = args.tags;
  }
  if (args.metadata != null) {
    body.metadata = args.metadata;
  }
  if (Object.keys(body).length === 0) {
    throw new Error("update requires at least one of --content, --tags, or --metadata.");
  }
  return JSON.stringify(body);
}

function buildUpdateHeaders(baseHeaders, args) {
  if (!args.ifMatch) {
    return baseHeaders;
  }
  return { ...baseHeaders, "If-Match": String(args.ifMatch) };
}

async function runCommand(args) {
  const auth = resolveSkillAuth();
  const headers = mem9Headers(auth.apiKey, process.env.MEM9_WRITER_ID || DEFAULT_WRITER_ID);
  const options = { headers, timeoutMs: args.timeoutMs };
  const memoriesBase = "v1alpha2/mem9s/memories";

  switch (args.command) {
    case "status":
      return mem9FetchJson(buildMem9Url(auth.baseUrl, "v1alpha2/status"), options);
    case "list":
      return mem9FetchJson(buildListUrl(auth.baseUrl, args), options);
    case "get":
      return mem9FetchJson(
        buildMem9Url(auth.baseUrl, `${memoriesBase}/${encodeURIComponent(args.id)}`),
        options,
      );
    case "update":
      return mem9FetchJson(
        buildMem9Url(auth.baseUrl, `${memoriesBase}/${encodeURIComponent(args.id)}`),
        { ...options, method: "PUT", body: buildUpdateBody(args), headers: buildUpdateHeaders(headers, args) },
      );
    case "delete":
      await mem9FetchJson(
        buildMem9Url(auth.baseUrl, `${memoriesBase}/${encodeURIComponent(args.id)}`),
        { ...options, method: "DELETE" },
      );
      return { deleted: true, id: args.id };
    case "batch-delete":
      return mem9FetchJson(buildMem9Url(auth.baseUrl, `${memoriesBase}/batch-delete`), {
        ...options,
        method: "POST",
        body: JSON.stringify({ ids: args.ids }),
      });
    case "session-messages":
      return mem9FetchJson(buildSessionMessagesUrl(auth.baseUrl, args), options);
    default:
      throw new Error(`Unknown command: ${args.command}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (shouldWriteHelp(argv)) {
    process.stdout.write(`${buildHelpText()}\n`);
    return 0;
  }

  const args = parseArgs(argv);
  const payload = await runCommand(args);
  if (payload != null) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
  return 0;
}

function errorExit(error) {
  if (error instanceof Mem9SkillAuthError) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  if (error instanceof Mem9HttpError) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exit(code);
    },
    (error) => {
      process.exit(errorExit(error));
    },
  );
}
