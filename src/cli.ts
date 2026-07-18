import { createHash } from "node:crypto";
import { ApiError, SchedulingApi } from "./api.js";
import { loadConfig } from "./config.js";
import { AvailabilityOptions, BookingInput, Slot, Team } from "./types.js";

class InputError extends Error {}

type Parsed = { command?: string; options: Map<string, string | boolean>; positional: string[] };

const usage = `JunkDoctors Scheduling CLI

Usage:
  jd-schedule slots [options]
  jd-schedule book --name NAME --phone PHONE --address ADDRESS --date YYYY-MM-DD \
    --start HH:MM --end HH:MM --description TEXT [options]

Commands:
  slots  Find open Team A/B/C service windows
  book   Preview or create a service booking (preview is the default)

Write safety:
  book never writes unless --yes is present. The server rechecks availability.

Common options:
  --json                 Stable machine-readable output
  -h, --help             Show help

Slots options:
  --date YYYY-MM-DD       First day (default: server today)
  --days N               Number of days
  --team all|a|b|c       Team filter
  --duration N           Service duration in minutes
  --step N               Slot interval in minutes
  --start HH:MM           Workday start
  --end HH:MM             Workday end
  --booked                Include conflicting slots
  --limit N               Maximum rows per result set

Book options:
  --name TEXT             Customer full name (required)
  --phone TEXT            US phone number (required)
  --address TEXT          Service address (required)
  --date YYYY-MM-DD       Service date (required)
  --start HH:MM           Start time, 24-hour clock (required)
  --end HH:MM             End time, 24-hour clock (required)
  --description TEXT      Service notes (required)
  --email TEXT            Customer email
  --source TEXT           Lead source (default: Scheduling CLI)
  --referrer TEXT         Referrer
  --team a|b|c            Assigned team (default: a)
  --idempotency-key KEY   Retry key; deterministic when omitted
  --dry-run               Preview only (default)
  --yes                   Commit the booking

Configuration:
  JD_SCHEDULING_API_TOKEN      Required per-agent token from Dash Agent Skills
                               (jdsa_ + 64 lowercase hexadecimal characters)
  JD_SCHEDULING_API_BASE_URL   Optional API base override
  JD_API_BASE_URL and ~/.jd/config.json may supply only the API base URL.
  JD_API_TOKEN is never used for scheduling authentication.
`;

export async function run(argv: string[]): Promise<void> {
  let json = argv.includes("--json");
  try {
    const parsed = parse(argv);
    json = parsed.options.has("json");
    if (!parsed.command || parsed.options.has("help") || parsed.command === "help") {
      console.log(usage);
      return;
    }
    if (parsed.positional.length > 0) {
      throw new InputError(`Unexpected argument${parsed.positional.length === 1 ? "" : "s"}: ${parsed.positional.join(" ")}`);
    }
    const api = new SchedulingApi(loadConfig());
    if (parsed.command === "slots") {
      const options = slotsInput(parsed.options);
      const result = await api.availability(options);
      if (!result || !Array.isArray(result.availability) || !Array.isArray(result.booked) || !result.meta || typeof result.meta !== "object") {
        throw new ApiError("Scheduling API returned a malformed availability response.", undefined, "invalid_response");
      }
      output(json, { ok: true, command: "slots", data: result }, () => slotsHuman([...result.availability, ...result.booked]));
      return;
    }
    if (parsed.command === "book") {
      const input = bookingInput(parsed.options);
      const result = await api.book(input);
      if (!result || typeof result !== "object" || !result.booking || typeof result.booking !== "object" || typeof result.dryRun !== "boolean" || typeof result.changed !== "boolean") {
        throw new ApiError("Scheduling API returned a malformed booking response.", undefined, "invalid_response");
      }
      output(json, { ok: true, command: "book", data: result }, () => bookingHuman(result));
      return;
    }
    throw new InputError(`Unknown command: ${parsed.command}`);
  } catch (error) {
    fail(error, json);
  }
}

function parse(argv: string[]): Parsed {
  const positional: string[] = [];
  const options = new Map<string, string | boolean>();
  let command: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("-")) {
      if (!command) command = arg;
      else positional.push(arg);
      continue;
    }
    const normalized = arg === "-h" ? "--help" : arg;
    if (!normalized.startsWith("--")) throw new InputError(`Unknown option: ${arg}`);
    const raw = normalized.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) {
      const name = raw.slice(0, equals);
      if (["help", "json", "booked", "yes", "dry-run"].includes(name)) {
        throw new InputError(`Boolean option --${name} does not accept a value.`);
      }
      options.set(name, raw.slice(equals + 1));
      continue;
    }
    const flags = new Set(["help", "json", "booked", "yes", "dry-run"]);
    if (flags.has(raw)) {
      options.set(raw, true);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new InputError(`Option --${raw} requires a value.`);
    options.set(raw, value);
    index++;
  }
  return { command, options, positional };
}

function slotsInput(options: Map<string, string | boolean>): AvailabilityOptions {
  allowed(options, ["json", "help", "date", "days", "team", "duration", "step", "start", "end", "booked", "limit"]);
  const team = optional(options, "team") as Team | undefined;
  if (team && !["all", "a", "b", "c"].includes(team)) throw new InputError("--team must be all, a, b, or c.");
  const date = optional(options, "date");
  if (date) validDate(date, "--date");
  const start = optional(options, "start");
  const end = optional(options, "end");
  if (start) validTime(start, "--start");
  if (end) validTime(end, "--end");
  return {
    date,
    days: integer(options, "days", 1, 60),
    duration: integer(options, "duration", 30, 480),
    step: integer(options, "step", 15, 240),
    start,
    end,
    team,
    limit: integer(options, "limit", 1, 1000),
    includeBooked: options.has("booked")
  };
}

function bookingInput(options: Map<string, string | boolean>): BookingInput {
  allowed(options, ["json", "help", "name", "phone", "address", "date", "start", "end", "description", "email", "source", "referrer", "team", "idempotency-key", "yes", "dry-run"]);
  if (options.has("yes") && options.has("dry-run")) throw new InputError("Use either --yes or --dry-run, not both.");
  const name = required(options, "name");
  const phone = normalizePhone(required(options, "phone"));
  const address = required(options, "address");
  const date = required(options, "date");
  const startTime = required(options, "start");
  const endTime = required(options, "end");
  const description = required(options, "description");
  validDate(date, "--date");
  validTime(startTime, "--start");
  validTime(endTime, "--end");
  if (minutes(endTime) <= minutes(startTime)) throw new InputError("--end must be after --start on the same day.");
  const email = optional(options, "email");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError("--email must be a valid email address.");
  const teamValue = optional(options, "team") ?? "a";
  if (!["a", "b", "c"].includes(teamValue)) throw new InputError("--team must be a, b, or c for booking.");
  const core = {
    name, phone, address, date, startTime, endTime, description,
    email, source: optional(options, "source") ?? "Scheduling CLI",
    referrer: optional(options, "referrer"), team: teamValue as "a" | "b" | "c"
  };
  const idempotencyKey = optional(options, "idempotency-key") ?? createHash("sha256").update(JSON.stringify(core)).digest("hex").slice(0, 32);
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new InputError("--idempotency-key must be 8-128 safe characters.");
  return { ...core, dryRun: !options.has("yes"), idempotencyKey };
}

function allowed(options: Map<string, string | boolean>, names: string[]): void {
  for (const key of options.keys()) if (!names.includes(key)) throw new InputError(`Unknown option: --${key}`);
}

function required(options: Map<string, string | boolean>, name: string): string {
  const value = optional(options, name);
  if (!value) throw new InputError(`--${name} is required.`);
  return value;
}

function optional(options: Map<string, string | boolean>, name: string): string | undefined {
  const value = options.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integer(options: Map<string, string | boolean>, name: string, min: number, max: number): number | undefined {
  const value = optional(options, name);
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) throw new InputError(`--${name} must be a whole number.`);
  const parsed = Number(value);
  if (parsed < min || parsed > max) throw new InputError(`--${name} must be between ${min} and ${max}.`);
  return parsed;
}

function validDate(value: string, label: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new InputError(`${label} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new InputError(`${label} is not a valid calendar date.`);
}

function validTime(value: string, label: string): void {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new InputError(`${label} must use 24-hour HH:MM.`);
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) throw new InputError("--phone must contain a 10-digit US phone number.");
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function slotsHuman(slots: Slot[]): string {
  if (!slots.length) return "No open scheduling slots found.";
  const lines = ["DATE        WINDOW             TEAM     STATUS", "----------  -----------------  -------  ---------"];
  for (const slot of slots) lines.push(`${slot.date.padEnd(10)}  ${slot.window.padEnd(17)}  ${slot.team.padEnd(7)}  ${slot.available ? "available" : "booked"}`);
  return lines.join("\n");
}

function bookingHuman(result: { dryRun: boolean; changed: boolean; booking: { name: string; phone: string; date: string; window?: string; startTime: string; endTime: string; address: string; team: string; jobId?: string }; idempotentReplay?: boolean }): string {
  const b = result.booking;
  return [
    result.dryRun ? "BOOKING PREVIEW (no changes made)" : result.idempotentReplay ? "BOOKING ALREADY EXISTS (safe replay)" : "BOOKING CREATED",
    `Customer: ${b.name} (${b.phone})`,
    `When: ${b.date} ${b.window ?? `${b.startTime} - ${b.endTime}`}`,
    `Team: ${b.team}`,
    `Address: ${b.address}`,
    ...(b.jobId ? [`Job ID: ${b.jobId}`] : []),
    ...(result.dryRun ? ["Run the same command with --yes to commit."] : [])
  ].join("\n");
}

function output(json: boolean, value: unknown, human: () => string): void {
  console.log(json ? JSON.stringify(value, null, 2) : human());
}

function fail(error: unknown, json: boolean): void {
  const input = error instanceof InputError;
  const api = error instanceof ApiError;
  const code = input ? "invalid_input" : api ? error.code : "unexpected_error";
  const message = error instanceof Error ? error.message : "Unexpected error.";
  const status = api ? error.status : undefined;
  const payload = { ok: false, error: { code, message, ...(status ? { status } : {}) } };
  console.error(json ? JSON.stringify(payload, null, 2) : `Error [${code}]: ${message}`);
  process.exitCode = input ? 2 : status === 401 || status === 403 || code === "auth_missing" || code === "auth_invalid" ? 3 : status === 409 ? 4 : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
