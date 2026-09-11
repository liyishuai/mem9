// @ts-nocheck
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  buildInspectSummary,
  parseArgs,
  resolveDataDir,
  runCleanup,
} from "../skills/cleanup/scripts/cleanup.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = new URL("../skills/cleanup/scripts/cleanup.mjs", import.meta.url).pathname;

function makeDataDir() {
  const dir = path.join(tmpdir(), `mem9-cleanup-test-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(path.join(dir, "logs"), { recursive: true });
  writeFileSync(path.join(dir, "auth.json"), JSON.stringify({ api_key: "secret" }));
  writeFileSync(path.join(dir, "runtime-notices.json"), "{}");
  writeFileSync(path.join(dir, "logs", "hooks.jsonl"), "{}\n");
  writeFileSync(path.join(dir, "unrelated.txt"), "keep me");
  return dir;
}

test("parseArgs parses inspect and run with flags", () => {
  const inspect = parseArgs(["inspect"]);
  assert.equal(inspect.command, "inspect");
  assert.equal(inspect.includeLogs, false);

  const run = parseArgs(["run", "--include-logs"]);
  assert.equal(run.command, "run");
  assert.equal(run.includeLogs, true);

  assert.throws(() => parseArgs(["destroy"]), /Unknown command/);
  assert.throws(() => parseArgs(["run", "--unknown"]), /Unknown argument/);
});

test("resolveDataDir prefers override, then env, and rejects empty", () => {
  assert.equal(resolveDataDir({ CLAUDE_PLUGIN_DATA: "/from-env" }, "/override"), "/override");
  assert.equal(resolveDataDir({ CLAUDE_PLUGIN_DATA: "/from-env" }, ""), "/from-env");
  assert.throws(() => resolveDataDir({}, ""), /plugin data directory/);
});

test("inspect summary reports targets without deleting anything", () => {
  const dir = makeDataDir();
  const summary = buildInspectSummary(dir);

  assert.equal(summary.targets.length, 3);
  const keys = summary.targets.map((target) => target.key);
  assert.deepEqual(keys, ["auth_cache", "runtime_notices", "debug_logs"]);

  const byKey = Object.fromEntries(summary.targets.map((target) => [target.key, target]));
  assert.equal(byKey.auth_cache.exists, true);
  assert.equal(byKey.auth_cache.removableByDefault, true);
  assert.equal(byKey.debug_logs.removableByDefault, false);

  assert.ok(existsSync(path.join(dir, "auth.json")));
});

test("runCleanup removes auth and notices but keeps logs and unrelated files", () => {
  const dir = makeDataDir();
  const result = runCleanup(dir);

  assert.deepEqual(result.removed, ["auth_cache", "runtime_notices"]);
  assert.equal(existsSync(path.join(dir, "auth.json")), false);
  assert.equal(existsSync(path.join(dir, "runtime-notices.json")), false);
  assert.equal(existsSync(path.join(dir, "logs")), true);
  assert.equal(existsSync(path.join(dir, "unrelated.txt")), true);
});

test("runCleanup with includeLogs also removes the logs directory", () => {
  const dir = makeDataDir();
  const result = runCleanup(dir, { includeLogs: true });

  assert.deepEqual(result.removed, ["auth_cache", "runtime_notices", "debug_logs"]);
  assert.equal(existsSync(path.join(dir, "logs")), false);
  assert.equal(existsSync(path.join(dir, "unrelated.txt")), true);
});

test("runCleanup reports already clean targets", () => {
  const dir = makeDataDir();
  runCleanup(dir, { includeLogs: true });
  const second = runCleanup(dir, { includeLogs: true });

  assert.deepEqual(second.removed, []);
  assert.deepEqual(second.alreadyClean, ["auth_cache", "runtime_notices", "debug_logs"]);
});

test("inspect via CLI prints JSON and exits 0", async () => {
  const dir = makeDataDir();
  const { stdout } = await execFileAsync(process.execPath, [SCRIPT_PATH, "inspect", "--data-dir", dir], {
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dir },
  });

  const payload = JSON.parse(stdout);
  assert.equal(payload.targets.length, 3);
  assert.ok(existsSync(path.join(dir, "auth.json")));
});

test("run via CLI removes local state and never prints the API key", async () => {
  const dir = makeDataDir();
  const { stdout } = await execFileAsync(
    process.execPath,
    [SCRIPT_PATH, "run", "--include-logs", "--data-dir", dir],
    { env: { ...process.env, CLAUDE_PLUGIN_DATA: dir } },
  );

  const payload = JSON.parse(stdout);
  assert.deepEqual(payload.removed, ["auth_cache", "runtime_notices", "debug_logs"]);
  assert.equal(stdout.includes("secret"), false);
  assert.equal(existsSync(path.join(dir, "logs")), false);
  assert.equal(existsSync(path.join(dir, "unrelated.txt")), true);
});

test("CLI fails with guidance when no data dir is available", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [SCRIPT_PATH, "inspect"], {
      env: { ...process.env, CLAUDE_PLUGIN_DATA: "" },
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.ok(String(error.stderr).includes("plugin data directory"));
      return true;
    },
  );
});
