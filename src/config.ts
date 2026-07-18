import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const defaultApiBaseUrl = "https://www.junkdoctorsnj.com/dash/api/cli";

export interface Config {
  apiBaseUrl: string;
  apiToken?: string;
  timeoutMs: number;
}

interface StoredConfig {
  apiBaseUrl?: unknown;
}

export function loadConfig(): Config {
  const stored = readStoredConfig(path.join(os.homedir(), ".jd", "config.json"));
  const tokenFromEnvironment = Object.prototype.hasOwnProperty.call(process.env, "JD_SCHEDULING_API_TOKEN");
  return {
    apiBaseUrl: clean(process.env.JD_SCHEDULING_API_BASE_URL) ?? clean(process.env.JD_API_BASE_URL) ?? clean(stored.apiBaseUrl) ?? defaultApiBaseUrl,
    apiToken: tokenFromEnvironment
      ? clean(process.env.JD_SCHEDULING_API_TOKEN)
      : readTokenFile(path.join(os.homedir(), ".jd", "scheduling-token")),
    timeoutMs: parseTimeout(process.env.JD_SCHEDULING_TIMEOUT_MS)
  };
}

function readTokenFile(file: string): string | undefined {
  if (process.platform === "win32") return undefined;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return undefined;
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return undefined;
    if ((stat.mode & 0o077) !== 0) return undefined;
    return clean(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function readStoredConfig(file: string): StoredConfig {
  if (!fs.existsSync(file)) return {};
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return value && typeof value === "object" ? value as StoredConfig : {};
  } catch {
    return {};
  }
}

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseTimeout(value: string | undefined): number {
  if (!value) return 15_000;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 120_000 ? parsed : 15_000;
}
