// @ts-nocheck
// skill-auth.mjs - Shared auth and HTTP helpers for mem9 skill scripts.

import { readFileSync } from "node:fs";

const DEFAULT_BASE_URL = "https://api.mem9.ai";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const PLUGIN_VERSION_FALLBACK = "unknown";

function readPluginVersion() {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8"),
    );
    return typeof manifest.version === "string" && manifest.version.trim()
      ? manifest.version.trim()
      : PLUGIN_VERSION_FALLBACK;
  } catch {
    return PLUGIN_VERSION_FALLBACK;
  }
}

export const MEM9_PLUGIN_USER_AGENT = `mem9-plugin/claude-code/${readPluginVersion()}`;
export const DEFAULT_SKILL_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS;

export class Mem9SkillAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "Mem9SkillAuthError";
  }
}

export class Mem9HttpError extends Error {
  constructor(message, { status, body, data } = {}) {
    super(message);
    this.name = "Mem9HttpError";
    this.status = status;
    this.body = body ?? "";
    this.data = data;
  }
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolve skill credentials the same way hooks do: MEM9_API_KEY env first,
 * then ${CLAUDE_PLUGIN_DATA}/auth.json.
 *
 * @returns {{baseUrl: string, apiKey: string, source: string}}
 */
export function resolveSkillAuth(env = process.env) {
  const envKey = normalizeString(env.MEM9_API_KEY);
  if (envKey) {
    return {
      baseUrl: normalizeString(env.MEM9_API_URL) || DEFAULT_BASE_URL,
      apiKey: envKey,
      source: "env",
    };
  }

  const dataDir = normalizeString(env.CLAUDE_PLUGIN_DATA);
  if (!dataDir) {
    throw new Mem9SkillAuthError(
      "mem9 auth is unavailable: MEM9_API_KEY is not set and CLAUDE_PLUGIN_DATA is not defined. Run /mem9:setup first.",
    );
  }

  let auth;
  try {
    auth = JSON.parse(readFileSync(`${dataDir}/auth.json`, "utf8"));
  } catch {
    throw new Mem9SkillAuthError(
      `mem9 auth is unavailable: cannot read ${dataDir}/auth.json. Run /mem9:setup first.`,
    );
  }

  const apiKey = normalizeString(auth && auth.api_key);
  if (!apiKey) {
    throw new Mem9SkillAuthError(
      `mem9 auth is unavailable: ${dataDir}/auth.json has no api_key. Run /mem9:setup first.`,
    );
  }

  return {
    baseUrl: normalizeString(auth.base_url) || DEFAULT_BASE_URL,
    apiKey,
    source: "auth_file",
  };
}

export function mem9Headers(apiKey, agentId, userAgent = MEM9_PLUGIN_USER_AGENT) {
  return {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
    "X-Mnemo-Agent-Id": agentId,
    "User-Agent": userAgent,
  };
}

export function buildMem9Url(baseUrl, relativePath) {
  return new URL(
    String(relativePath ?? "").replace(/^\/+/, ""),
    `${String(baseUrl ?? "").replace(/\/+$/, "")}/`,
  );
}

function parseJsonOrNull(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorMessageFromBody(status, body, data) {
  if (data && typeof data === "object") {
    if (typeof data.message === "string" && data.message.trim()) {
      return data.message.trim();
    }
    if (typeof data.error === "string" && data.error.trim()) {
      return data.error.trim();
    }
  }

  const text = String(body ?? "").trim();
  if (text) {
    return text;
  }

  return `HTTP ${status}`;
}

/**
 * Fetch JSON from the mem9 API. Returns null for 204 or empty bodies.
 * Throws Mem9HttpError for non-2xx responses.
 */
export async function mem9FetchJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text();
    const data = parseJsonOrNull(body);
    throw new Mem9HttpError(
      `mem9 request failed (${response.status}): ${errorMessageFromBody(response.status, body, data)}`,
      { status: response.status, body, data },
    );
  }

  if (response.status === 204) {
    return null;
  }

  const body = await response.text();
  if (!body) {
    return null;
  }

  return JSON.parse(body);
}
