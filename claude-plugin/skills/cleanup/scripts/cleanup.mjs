#!/usr/bin/env node
// @ts-nocheck
// cleanup.mjs - Remove mem9-managed local plugin state before reinstalling, resetting,
// or uninstalling the mem9 Claude Code plugin.

import { existsSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ALWAYS_REMOVABLE = [
  {
    key: "auth_cache",
    file: "auth.json",
    description: "Cached mem9 API key. Removing it forces re-provisioning on next session start.",
  },
  {
    key: "runtime_notices",
    file: "runtime-notices.json",
    description: "Runtime quota notice state shown by mem9 hooks.",
  },
];

const LOGS_TARGET = {
  key: "debug_logs",
  file: "logs",
  description: "mem9 hook debug logs. Removed only with --include-logs.",
};

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
  return tokens.length === 0 || isHelpToken(tokens[0]) || tokens.some(isHelpToken);
}

function buildHelpText() {
  return [
    "mem9 cleanup",
    "",
    "Remove mem9-managed local plugin state before reinstalling, resetting, or",
    "uninstalling the mem9 Claude Code plugin.",
    "",
    "Usage:",
    "  node ./scripts/cleanup.mjs inspect",
    "  node ./scripts/cleanup.mjs run [--include-logs] [--data-dir <path>]",
    "",
    "Commands:",
    "  inspect          Print a JSON summary of removable mem9-managed local files.",
    "  run              Remove the mem9 auth cache and runtime notice state.",
    "  run --include-logs  Also remove mem9 debug logs.",
    "",
    "Flags:",
    "  --include-logs   Include ${CLAUDE_PLUGIN_DATA}/logs in run.",
    "  --data-dir <path>  Override the plugin data directory (defaults to",
    "                     ${CLAUDE_PLUGIN_DATA}).",
    "",
    "Notes:",
    "  - inspect and run print sanitized paths; home directories are shortened to ~.",
    "  - Cloud memories, quota usage, and billing state are NOT deleted.",
    "  - After run, the next Claude Code session auto-provisions a new API key under",
    "    a fresh tenant; previous cloud memories stay with the old key.",
    "  - The plugin data directory itself is left in place. Claude Code owns it.",
    "  - Do not print API keys or credential file contents.",
    "",
  ].join("\n");
}

function resolveDataDir(env = process.env, override = "") {
  const dir = normalizeString(override) || normalizeString(env.CLAUDE_PLUGIN_DATA);
  if (!dir) {
    throw new Error(
      "mem9 cleanup needs a plugin data directory. Set CLAUDE_PLUGIN_DATA or pass --data-dir.",
    );
  }
  return path.resolve(dir);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    command: "",
    includeLogs: false,
    dataDir: "",
  };

  const tokens = Array.isArray(argv) ? argv : [];
  if (tokens.length === 0) {
    return args;
  }

  args.command = normalizeString(tokens[0]);

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    switch (token) {
      case "--include-logs":
        args.includeLogs = true;
        break;
      case "--data-dir":
        args.dataDir = normalizeString(tokens[index + 1]);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!["inspect", "run"].includes(args.command)) {
    throw new Error(`Unknown command: ${args.command || "(none)"}. Run with --help for usage.`);
  }

  return args;
}

function sanitizePath(filePath) {
  const home = process.env.HOME || "";
  if (home && filePath.startsWith(home)) {
    return `~${filePath.slice(home.length)}`;
  }
  return filePath;
}

function targetState(dataDir, target) {
  const fullPath = path.join(dataDir, target.file);
  let exists = false;
  let bytes = 0;
  if (existsSync(fullPath)) {
    exists = true;
    try {
      bytes = statSync(fullPath).size;
    } catch {
      bytes = 0;
    }
  }
  return {
    key: target.key,
    path: sanitizePath(fullPath),
    description: target.description,
    exists,
    bytes,
    removableByDefault: target !== LOGS_TARGET,
  };
}

function buildInspectSummary(dataDir) {
  const targets = [...ALWAYS_REMOVABLE, LOGS_TARGET];
  return {
    dataDir: sanitizePath(dataDir),
    targets: targets.map((target) => targetState(dataDir, target)),
    notes: [
      "run removes targets with removableByDefault true.",
      "run --include-logs also removes debug_logs.",
      "Cloud memories, quota usage, and billing state are not affected.",
      "After run, the next Claude Code session auto-provisions a new API key.",
    ],
  };
}

function runCleanup(dataDir, { includeLogs = false } = {}) {
  const removed = [];
  const missing = [];

  const targets = [...ALWAYS_REMOVABLE];
  if (includeLogs) {
    targets.push(LOGS_TARGET);
  }

  for (const target of targets) {
    const fullPath = path.join(dataDir, target.file);
    if (!existsSync(fullPath)) {
      missing.push(target.key);
      continue;
    }
    rmSync(fullPath, { recursive: true, force: true });
    removed.push(target.key);
  }

  return {
    dataDir: sanitizePath(dataDir),
    includeLogs,
    removed,
    alreadyClean: missing,
    notes: [
      "Cloud memories, quota usage, and billing state are not affected.",
      "The next Claude Code session auto-provisions a new API key.",
    ],
  };
}

async function main(argv = process.argv.slice(2)) {
  if (shouldWriteHelp(argv)) {
    process.stdout.write(`${buildHelpText()}\n`);
    return 0;
  }

  const args = parseArgs(argv);
  const dataDir = resolveDataDir(process.env, args.dataDir);

  if (args.command === "inspect") {
    const summary = buildInspectSummary(dataDir);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return 0;
  }

  const result = runCleanup(dataDir, { includeLogs: args.includeLogs });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exit(code);
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
