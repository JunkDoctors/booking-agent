export type Team = "all" | "a" | "b" | "c";

export interface AvailabilityOptions {
  date?: string;
  days?: number;
  duration?: number;
  step?: number;
  start?: string;
  end?: string;
  team?: Team;
  limit?: number;
  includeBooked?: boolean;
}

export interface Conflict {
  jobId: string;
  client: string;
  city: string;
  address: string;
  start: string;
  end: string;
  window: string;
}

export interface Slot {
  date: string;
  day: string;
  start: string;
  end: string;
  window: string;
  team: string;
  teamKey: string;
  available: boolean;
  status?: string;
  summary?: string;
  conflicts: Conflict[];
}

/** Non-secret identity metadata for the agent authenticated by the API. */
export interface AuthenticatedActor {
  agentUserId: string;
  displayName: string;
}

export interface AvailabilityMeta extends Record<string, unknown> {
  actor: AuthenticatedActor;
}

export interface AvailabilityResult {
  availability: Slot[];
  booked: Slot[];
  meta: AvailabilityMeta;
}

export interface BookingInput {
  name: string;
  phone: string;
  address: string;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
  email?: string;
  source: string;
  referrer?: string;
  team: Exclude<Team, "all">;
  dryRun: boolean;
  idempotencyKey: string;
}

export interface BookingSnapshot {
  jobId?: string;
  customerId?: string;
  name: string;
  phone: string;
  email?: string;
  address: string;
  date: string;
  startTime: string;
  endTime: string;
  window?: string;
  description: string;
  source: string;
  referrer?: string;
  team: string;
  status?: string;
}

export interface BookingResult {
  ok: boolean;
  dryRun: boolean;
  changed: boolean;
  idempotentReplay?: boolean;
  idempotencyKey: string;
  booking: BookingSnapshot;
  actor: AuthenticatedActor;
  warnings?: string[];
}
