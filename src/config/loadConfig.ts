import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ZodError } from "zod";
import { ConfigSchema } from "./schema.js";
import type { Config } from "./schema.js";
import { defaultConfig } from "./defaultConfig.js";
import { resolvePolicyReference } from "./policies.js";

export interface LoadConfigOptions {
  policy?: string | null;
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "config";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeConfigValues(base: unknown, override: unknown): unknown {
  if (Array.isArray(override)) {
    return [...override];
  }

  if (!isRecord(base) || !isRecord(override)) {
    return cloneValue(override);
  }

  const next: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }
    next[key] = key in next ? mergeConfigValues(next[key], value) : cloneValue(value);
  }
  return next;
}

async function readJsonObject(filePath: string): Promise<JsonObject> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read config file at ${filePath}. Check that the file exists and that relative paths are resolved from the current workspace.`,
      { cause: error }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in config file at ${filePath}. Remove comments and trailing commas, then try again.`,
      { cause: error }
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      `Invalid config at ${filePath}: top-level value must be an object. Use configs/default.json as the reference shape.`
    );
  }

  return parsed;
}

async function loadLayeredConfig(
  filePath: string,
  visited: Set<string>
): Promise<JsonObject> {
  const resolvedPath = path.resolve(filePath);
  if (visited.has(resolvedPath)) {
    throw new Error(`Config extends cycle detected at ${resolvedPath}`);
  }

  visited.add(resolvedPath);
  const rawConfig = await readJsonObject(resolvedPath);
  const hasExtends = Object.prototype.hasOwnProperty.call(rawConfig, "extends");
  if (hasExtends && !Array.isArray(rawConfig.extends)) {
    throw new Error(
      `Invalid config at ${resolvedPath}: extends must be an array of policy references, for example ["policy:docs", "./configs/team-policy.json"].`
    );
  }

  const extendRefs: string[] = [];
  if (Array.isArray(rawConfig.extends)) {
    rawConfig.extends.forEach((entry, index) => {
      if (typeof entry !== "string") {
        throw new Error(
          `Invalid config at ${resolvedPath}: extends[${index}] must be a string policy reference such as "policy:docs" or "./configs/team-policy.json".`
        );
      }
      if (entry.trim().length === 0) {
        throw new Error(
          `Invalid config at ${resolvedPath}: extends[${index}] must not be empty.`
        );
      }
      extendRefs.push(entry);
    });
  }

  let merged: JsonObject = {};
  for (const ref of extendRefs) {
    const resolvedReference = resolvePolicyReference(ref, path.dirname(resolvedPath));
    const layer = await loadLayeredConfig(resolvedReference, visited);
    merged = mergeConfigValues(merged, layer) as JsonObject;
  }

  const selfConfig: JsonObject = { ...rawConfig };
  delete selfConfig.extends;

  visited.delete(resolvedPath);
  return mergeConfigValues(merged, selfConfig) as JsonObject;
}

export async function loadConfig(configPath: string, options: LoadConfigOptions = {}): Promise<Config> {
  let merged: JsonObject = cloneValue(defaultConfig) as JsonObject;

  if (options.policy) {
    const policyPath = resolvePolicyReference(options.policy, process.cwd());
    const policyLayer = await loadLayeredConfig(policyPath, new Set());
    merged = mergeConfigValues(merged, policyLayer) as JsonObject;
  }

  const configLayer = await loadLayeredConfig(configPath, new Set());
  merged = mergeConfigValues(merged, configLayer) as JsonObject;

  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(
      `Invalid config at ${configPath}: ${formatZodError(result.error)}. ` +
        `Use configs/default.json as the reference shape, then override only the fields you need.`
    );
  }

  return result.data;
}
