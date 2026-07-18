import { Config } from "./config.js";
import { AvailabilityOptions, AvailabilityResult, BookingInput, BookingResult } from "./types.js";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code = "api_error"
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class SchedulingApi {
  constructor(private readonly config: Config) {}

  async availability(options: AvailabilityOptions): Promise<AvailabilityResult> {
    const query = new URLSearchParams();
    add(query, "date", options.date);
    add(query, "days", options.days);
    add(query, "duration", options.duration);
    add(query, "step", options.step);
    add(query, "start", options.start);
    add(query, "end", options.end);
    add(query, "team", options.team);
    add(query, "limit", options.limit);
    if (options.includeBooked) query.set("include_booked", "1");
    return this.request<AvailabilityResult>(`/schedule.php?${query.toString()}`, { method: "GET" });
  }

  async book(input: BookingInput): Promise<BookingResult> {
    return this.request<BookingResult>("/schedule.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey
      },
      body: JSON.stringify(input)
    });
  }

  private async request<T>(relative: string, init: RequestInit): Promise<T> {
    if (!this.config.apiToken) {
      throw new ApiError("A per-agent scheduling token is required. Generate one in Dash Agent Skills and set JD_SCHEDULING_API_TOKEN.", undefined, "auth_missing");
    }
    if (!/^jdsa_[a-f0-9]{64}$/.test(this.config.apiToken)) {
      throw new ApiError("JD_SCHEDULING_API_TOKEN is malformed. Expected jdsa_ followed by 64 lowercase hexadecimal characters.", undefined, "auth_invalid");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const base = this.config.apiBaseUrl.replace(/\/$/, "");
    try {
      const response = await fetch(`${base}${relative}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.apiToken}`,
          "User-Agent": "junkdoctors-scheduling-cli/0.1.0",
          ...init.headers
        }
      });
      const text = await response.text();
      let data: unknown = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      if (!response.ok) {
        const record = isRecord(data) ? data : {};
        const message = sanitizeApiText(
          stringValue(record.message) ?? stringValue(record.error) ?? `Scheduling API returned HTTP ${response.status}.`,
          this.config.apiToken
        );
        const code = sanitizeApiText(stringValue(record.code) ?? statusCode(response.status), this.config.apiToken);
        throw new ApiError(message, response.status, code);
      }
      return data as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiError(`Scheduling API timed out after ${this.config.timeoutMs}ms.`, undefined, "timeout");
      }
      const message = error instanceof Error ? error.message : "Scheduling API request failed.";
      throw new ApiError(sanitizeApiText(message, this.config.apiToken), undefined, "network_error");
    } finally {
      clearTimeout(timer);
    }
  }
}

function add(query: URLSearchParams, name: string, value: string | number | undefined): void {
  if (value !== undefined) query.set(name, String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function sanitizeApiText(value: string, configuredToken: string): string {
  const redaction = "[REDACTED]";
  return value
    .replaceAll(configuredToken, redaction)
    .replace(/jdsa_[a-f0-9]{64}/g, redaction);
}

function statusCode(status: number): string {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 409) return "schedule_conflict";
  if (status === 422 || status === 400) return "invalid_request";
  return "api_error";
}
