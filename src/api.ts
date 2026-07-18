import { Config } from "./config.js";
import { AvailabilityOptions, AvailabilityResult, BookingInput, BookingResult } from "./types.js";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code = "api_error",
    public readonly details?: unknown
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
      throw new ApiError("API token is required. Set JD_SCHEDULING_API_TOKEN or JD_API_TOKEN, or configure ~/.jd/config.json.", undefined, "auth_missing");
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
        const message = stringValue(record.message) ?? stringValue(record.error) ?? `Scheduling API returned HTTP ${response.status}.`;
        const code = stringValue(record.code) ?? statusCode(response.status);
        throw new ApiError(message, response.status, code, data);
      }
      return data as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiError(`Scheduling API timed out after ${this.config.timeoutMs}ms.`, undefined, "timeout");
      }
      throw new ApiError(error instanceof Error ? error.message : "Scheduling API request failed.", undefined, "network_error");
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

function statusCode(status: number): string {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 409) return "schedule_conflict";
  if (status === 422 || status === 400) return "invalid_request";
  return "api_error";
}
