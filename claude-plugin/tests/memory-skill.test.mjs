// @ts-nocheck
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  buildListUrl,
  buildSessionMessagesUrl,
  buildUpdateBody,
  parseArgs,
} from "../skills/memory/scripts/memory.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = new URL("../skills/memory/scripts/memory.mjs", import.meta.url).pathname;

const baseArgs = () => parseArgs(["list"]);

test("parseArgs parses list filters", () => {
  const args = parseArgs([
    "list",
    "--q",
    "release checklist",
    "--tags",
    "project, backend",
    "--memory-type",
    "pinned",
    "--state",
    "active",
    "--limit",
    "5",
    "--offset",
    "10",
    "--sort-by",
    "updated_at",
    "--sort-dir",
    "asc",
  ]);

  assert.equal(args.command, "list");
  assert.equal(args.q, "release checklist");
  assert.deepEqual(args.tags, ["project", "backend"]);
  assert.equal(args.memoryType, "pinned");
  assert.equal(args.state, "active");
  assert.equal(args.limit, 5);
  assert.equal(args.offset, 10);
  assert.equal(args.sortBy, "updated_at");
  assert.equal(args.sortDir, "asc");
});

test("parseArgs routes positional ids per command", () => {
  assert.equal(parseArgs(["get", "id-1"]).id, "id-1");
  assert.equal(parseArgs(["delete", "id-1"]).id, "id-1");
  assert.throws(() => parseArgs(["get"]), /exactly one memory id/);
  assert.deepEqual(parseArgs(["batch-delete", "id-1", "id-2"]).ids, ["id-1", "id-2"]);
  assert.throws(() => parseArgs(["batch-delete"]), /at least one memory id/);
  assert.throws(() => parseArgs(["purge"]), /Unknown command/);
  assert.throws(() => parseArgs(["list", "--nope"]), /Unknown argument/);
});

test("parseArgs collects repeated --session-id for session-messages", () => {
  const args = parseArgs(["session-messages", "--session-id", "s1", "--session-id", "s2"]);
  assert.deepEqual(args.sessionIds, ["s1", "s2"]);

  const listArgs = parseArgs(["list", "--session-id", "s1"]);
  assert.equal(listArgs.sessionId, "s1");
});

test("buildListUrl omits empty filters and defaults to all agents", () => {
  const args = { ...baseArgs(), q: "", tags: null, agentId: "" };
  const url = new URL(buildListUrl("https://api.mem9.ai", args));

  assert.equal(url.pathname, "/v1alpha2/mem9s/memories");
  assert.equal(url.searchParams.get("q"), null);
  assert.equal(url.searchParams.get("agent_id"), null);
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.searchParams.get("offset"), null);
});

test("buildListUrl encodes filters", () => {
  const args = {
    ...baseArgs(),
    q: "team preferences",
    tags: ["project", "backend"],
    memoryType: "insight",
    agentId: "claude-code-main",
    appId: "app-1",
    limit: 50,
    offset: 3,
  };
  const url = new URL(buildListUrl("https://api.mem9.ai/", args));

  assert.equal(url.searchParams.get("q"), "team preferences");
  assert.equal(url.searchParams.get("tags"), "project,backend");
  assert.equal(url.searchParams.get("memory_type"), "insight");
  assert.equal(url.searchParams.get("agent_id"), "claude-code-main");
  assert.equal(url.searchParams.get("appId"), "app-1");
  assert.equal(url.searchParams.get("limit"), "50");
  assert.equal(url.searchParams.get("offset"), "3");
});

test("buildSessionMessagesUrl repeats session_id params", () => {
  const args = { ...baseArgs(), sessionIds: ["s1", "s2"], limitPerSession: 10 };
  const url = new URL(buildSessionMessagesUrl("https://api.mem9.ai", args));

  assert.equal(url.pathname, "/v1alpha2/mem9s/session-messages");
  assert.deepEqual(url.searchParams.getAll("session_id"), ["s1", "s2"]);
  assert.equal(url.searchParams.get("limit_per_session"), "10");
});

test("buildSessionMessagesUrl requires at least one session id", () => {
  assert.throws(() => buildSessionMessagesUrl("https://api.mem9.ai", baseArgs()), /--session-id/);
});

test("buildUpdateBody shapes the PUT payload and validates emptiness", () => {
  const args = {
    ...baseArgs(),
    content: "Updated fact",
    tags: ["a", "b"],
    metadata: { origin: "claude" },
  };
  assert.deepEqual(JSON.parse(buildUpdateBody(args)), {
    content: "Updated fact",
    tags: ["a", "b"],
    metadata: { origin: "claude" },
  });

  assert.throws(() => buildUpdateBody(baseArgs()), /at least one of/);
  assert.throws(() => parseArgs(["update", "id-1", "--metadata", "[1,2]"]), /JSON object/);
});

function startStubServer(handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const record = {
          method: request.method,
          url: new URL(request.url, "http://localhost"),
          headers: request.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        };
        requests.push(record);
        handler(record, response);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, requests, port: server.address().port });
    });
  });
}

function jsonResponse(response, status, payload) {
  const body = payload === null ? "" : JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json",
    ...(payload && payload.version ? { ETag: String(payload.version) } : {}),
  });
  response.end(body);
}

const MEMORY = {
  id: "mem-1",
  content: "The team prefers tabs",
  memory_type: "insight",
  state: "active",
  version: 3,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-02T00:00:00Z",
};

async function withStubServer(handler, run) {
  const stub = await startStubServer(handler);
  try {
    return await run(stub);
  } finally {
    await new Promise((resolve) => stub.server.close(resolve));
  }
}

function cliEnv(port) {
  return {
    ...process.env,
    MEM9_API_URL: `http://127.0.0.1:${port}`,
    MEM9_API_KEY: "test-key",
    CLAUDE_PLUGIN_DATA: tmpdir(),
  };
}

test("status command hits /v1alpha2/status with auth headers", async () => {
  await withStubServer(
    (record, response) => {
      if (record.url.pathname === "/v1alpha2/status") {
        assert.equal(record.headers["x-api-key"], "test-key");
        assert.equal(record.headers["x-mnemo-agent-id"], "claude-code");
        assert.match(record.headers["user-agent"], /^mem9-plugin\/claude-code\//);
        jsonResponse(response, 200, { status: { key: "active" } });
        return;
      }
      jsonResponse(response, 404, { error: "not found" });
    },
    async (stub) => {
      const { stdout } = await execFileAsync(process.execPath, [SCRIPT_PATH, "status"], {
        env: cliEnv(stub.port),
      });
      assert.deepEqual(JSON.parse(stdout), { status: { key: "active" } });
    },
  );
});

test("list command sends filters and prints the response", async () => {
  await withStubServer(
    (record, response) => {
      assert.equal(record.url.pathname, "/v1alpha2/mem9s/memories");
      assert.equal(record.url.searchParams.get("q"), "tabs");
      assert.equal(record.url.searchParams.get("limit"), "5");
      jsonResponse(response, 200, { memories: [MEMORY], total: 1, limit: 5, offset: 0 });
    },
    async (stub) => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [SCRIPT_PATH, "list", "--q", "tabs", "--limit", "5"],
        { env: cliEnv(stub.port) },
      );
      const payload = JSON.parse(stdout);
      assert.equal(payload.total, 1);
      assert.equal(payload.memories[0].id, "mem-1");
    },
  );
});

test("get and update commands target the memory id path", async () => {
  await withStubServer(
    (record, response) => {
      if (record.url.pathname === "/v1alpha2/mem9s/memories/mem-1" && record.method === "GET") {
        jsonResponse(response, 200, MEMORY);
        return;
      }
      if (record.url.pathname === "/v1alpha2/mem9s/memories/mem-1" && record.method === "PUT") {
        assert.equal(record.headers["if-match"], "3");
        assert.deepEqual(JSON.parse(record.body), { content: "The team prefers spaces" });
        jsonResponse(response, 200, { ...MEMORY, content: "The team prefers spaces", version: 4 });
        return;
      }
      jsonResponse(response, 404, { error: "not found" });
    },
    async (stub) => {
      const got = await execFileAsync(process.execPath, [SCRIPT_PATH, "get", "mem-1"], {
        env: cliEnv(stub.port),
      });
      assert.equal(JSON.parse(got.stdout).id, "mem-1");

      const updated = await execFileAsync(
        process.execPath,
        [SCRIPT_PATH, "update", "mem-1", "--content", "The team prefers spaces", "--if-match", "3"],
        { env: cliEnv(stub.port) },
      );
      assert.equal(JSON.parse(updated.stdout).version, 4);
    },
  );
});

test("delete command handles 204 and prints a confirmation", async () => {
  await withStubServer(
    (record, response) => {
      assert.equal(record.method, "DELETE");
      assert.equal(record.url.pathname, "/v1alpha2/mem9s/memories/mem-1");
      response.writeHead(204);
      response.end();
    },
    async (stub) => {
      const { stdout } = await execFileAsync(process.execPath, [SCRIPT_PATH, "delete", "mem-1"], {
        env: cliEnv(stub.port),
      });
      assert.deepEqual(JSON.parse(stdout), { deleted: true, id: "mem-1" });
    },
  );
});

test("batch-delete posts the ids array", async () => {
  await withStubServer(
    (record, response) => {
      assert.equal(record.method, "POST");
      assert.equal(record.url.pathname, "/v1alpha2/mem9s/memories/batch-delete");
      assert.deepEqual(JSON.parse(record.body), { ids: ["mem-1", "mem-2"] });
      jsonResponse(response, 200, { deleted: 2 });
    },
    async (stub) => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [SCRIPT_PATH, "batch-delete", "mem-1", "mem-2"],
        { env: cliEnv(stub.port) },
      );
      assert.deepEqual(JSON.parse(stdout), { deleted: 2 });
    },
  );
});

test("session-messages command repeats session_id params", async () => {
  await withStubServer(
    (record, response) => {
      assert.equal(record.url.pathname, "/v1alpha2/mem9s/session-messages");
      assert.deepEqual(record.url.searchParams.getAll("session_id"), ["s1", "s2"]);
      jsonResponse(response, 200, { sessions: [] });
    },
    async (stub) => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [SCRIPT_PATH, "session-messages", "--session-id", "s1", "--session-id", "s2"],
        { env: cliEnv(stub.port) },
      );
      assert.deepEqual(JSON.parse(stdout), { sessions: [] });
    },
  );
});

test("HTTP errors print the server message and exit non-zero", async () => {
  await withStubServer(
    (record, response) => {
      jsonResponse(response, 429, {
        error: "Post-quota rate limit exceeded.",
        details: { errorCategory: "runtime_quota_denied" },
      });
    },
    async (stub) => {
      await assert.rejects(
        execFileAsync(process.execPath, [SCRIPT_PATH, "list"], { env: cliEnv(stub.port) }),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(String(error.stderr), /429/);
          assert.match(String(error.stderr), /Post-quota rate limit exceeded/);
          return true;
        },
      );
    },
  );
});

test("missing auth exits 2 with setup guidance", async () => {
  const env = {
    ...process.env,
    MEM9_API_KEY: "",
    MEM9_API_URL: "",
    CLAUDE_PLUGIN_DATA: path.join(tmpdir(), `mem9-missing-auth-${process.pid}`),
  };
  await assert.rejects(
    execFileAsync(process.execPath, [SCRIPT_PATH, "status"], { env }),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(String(error.stderr), /\/mem9:setup/);
      return true;
    },
  );
});

test("help text lists every command", async () => {
  const { stdout } = await execFileAsync(process.execPath, [SCRIPT_PATH, "--help"]);
  for (const command of ["status", "list", "get", "update", "delete", "batch-delete", "session-messages"]) {
    assert.ok(stdout.includes(command), `help should mention ${command}`);
  }
});
