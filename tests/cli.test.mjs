import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("..", import.meta.url);
const validToken = `jdsa_${"a".repeat(64)}`;

async function withApi(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function cli(args, baseUrl, overrides = {}) {
  const env = { ...process.env };
  delete env.JD_SCHEDULING_API_TOKEN;
  delete env.JD_API_TOKEN;
  return execFileAsync("node", ["bin/jd-schedule", ...args], {
    cwd: root,
    env: {
      ...env,
      JD_SCHEDULING_API_BASE_URL: baseUrl,
      JD_SCHEDULING_API_TOKEN: validToken,
      ...overrides
    }
  });
}

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

test("slots forwards filters and returns a stable JSON envelope", async () => {
  await withApi((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${validToken}`);
    const url = new URL(request.url, "http://localhost");
    assert.equal(url.pathname, "/schedule.php");
    assert.equal(url.searchParams.get("date"), "2026-07-20");
    assert.equal(url.searchParams.get("team"), "b");
    assert.equal(url.searchParams.get("include_booked"), "1");
    json(response, 200, {
      availability: [{ date: "2026-07-20", day: "Mon Jul 20", start: "2026-07-20 09:00:00", end: "2026-07-20 11:00:00", window: "9am - 11am", team: "Team B", teamKey: "b", available: true, conflicts: [] }],
      booked: [],
      meta: { timezone: "America/New_York", actor: { agentUserId: "agent00001", displayName: "Scheduler One" } }
    });
  }, async (baseUrl) => {
    const { stdout } = await cli(["slots", "--date", "2026-07-20", "--team", "b", "--booked", "--json"], baseUrl);
    const output = JSON.parse(stdout);
    assert.equal(output.ok, true);
    assert.equal(output.command, "slots");
    assert.equal(output.data.availability[0].teamKey, "b");
    assert.deepEqual(output.data.meta.actor, { agentUserId: "agent00001", displayName: "Scheduler One" });
  });
});

test("missing per-agent token exits auth failure and ignores legacy token sources without calling the API", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "jd-schedule-home-"));
  await mkdir(path.join(home, ".jd"));
  await writeFile(path.join(home, ".jd", "config.json"), JSON.stringify({ apiToken: "legacy-config-token" }));
  let calls = 0;
  try {
    await withApi((_request, response) => {
      calls++;
      json(response, 500, { error: "should not be called" });
    }, async (baseUrl) => {
      await assert.rejects(
        cli(["slots", "--json"], baseUrl, {
          HOME: home,
          JD_API_TOKEN: "legacy-shared-token",
          JD_SCHEDULING_API_TOKEN: undefined
        }),
        (error) => {
          assert.equal(error.code, 3);
          const payload = JSON.parse(error.stderr);
          assert.equal(payload.error.code, "auth_missing");
          assert.match(payload.error.message, /Agent Skills/);
          assert.doesNotMatch(error.stderr, /legacy-(?:shared|config)-token/);
          return true;
        }
      );
      assert.equal(calls, 0);
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("malformed per-agent token exits auth failure without calling the API or printing the token", async () => {
  const malformed = `jdsa_${"A".repeat(64)}`;
  let calls = 0;
  await withApi((_request, response) => {
    calls++;
    json(response, 500, { error: "should not be called" });
  }, async (baseUrl) => {
    await assert.rejects(
      cli(["slots", "--json"], baseUrl, { JD_SCHEDULING_API_TOKEN: malformed }),
      (error) => {
        assert.equal(error.code, 3);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.error.code, "auth_invalid");
        assert.match(payload.error.message, /64 lowercase hexadecimal characters/);
        assert.doesNotMatch(error.stderr, new RegExp(malformed));
        return true;
      }
    );
    assert.equal(calls, 0);
  });
});

test("help documents only per-agent scheduling tokens for authentication", async () => {
  const { stdout } = await cli(["--help"], "http://127.0.0.1:1");
  assert.match(stdout, /Required per-agent token from Dash Agent Skills/);
  assert.match(stdout, /JD_API_TOKEN is never used for scheduling authentication/);
  assert.doesNotMatch(stdout, /JD_SCHEDULING_API_TOKEN \/ JD_API_TOKEN/);
});

test("book defaults to dry-run and sends popup-equivalent fields", async () => {
  await withApi(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.match(request.headers["idempotency-key"], /^[a-f0-9]{32}$/);
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(body.dryRun, true);
    assert.equal(body.name, "Sample Customer");
    assert.equal(body.phone, "973-555-0100");
    assert.equal(body.source, "Phone");
    assert.equal(body.team, "a");
    assert.equal(body.idempotencyKey, request.headers["idempotency-key"]);
    json(response, 200, {
      ok: true,
      dryRun: true,
      changed: true,
      idempotencyKey: body.idempotencyKey,
      booking: { ...body, team: "Team A", window: "9am - 11am" },
      actor: { agentUserId: "agent00001", displayName: "Scheduler One" }
    });
  }, async (baseUrl) => {
    const { stdout } = await cli([
      "book", "--name", "Sample Customer", "--phone", "(973) 555-0100",
      "--address", "123 Main St, Sparta, NJ 07871", "--date", "2026-07-20",
      "--start", "09:00", "--end", "11:00", "--description", "Basement cleanout",
      "--source", "Phone", "--json"
    ], baseUrl);
    const output = JSON.parse(stdout);
    assert.equal(output.data.dryRun, true);
    assert.equal(output.data.changed, true);
    assert.deepEqual(output.data.actor, { agentUserId: "agent00001", displayName: "Scheduler One" });
  });
});

test("--yes is the only booking commit switch", async () => {
  await withApi(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(body.dryRun, false);
    json(response, 201, {
      ok: true,
      dryRun: false,
      changed: true,
      idempotencyKey: body.idempotencyKey,
      booking: { ...body, jobId: "job_123", team: "Team C" },
      actor: { agentUserId: "agent00001", displayName: "Scheduler One" }
    });
  }, async (baseUrl) => {
    const { stdout } = await cli([
      "book", "--name", "Sample Customer", "--phone", "9735550100",
      "--address", "123 Main St", "--date", "2026-07-20", "--start", "13:00",
      "--end", "15:00", "--description", "Garage cleanout", "--team", "c", "--yes"
    ], baseUrl);
    assert.match(stdout, /BOOKING CREATED/);
    assert.match(stdout, /Job ID: job_123/);
  });
});

test("boolean values cannot masquerade as write confirmation", async () => {
  await withApi((_request, response) => {
    json(response, 500, { error: "should not be called" });
  }, async (baseUrl) => {
    for (const value of ["--yes=false", "--yes=0", "--yes="]) {
      await assert.rejects(
        cli([
          "book", "--name", "Sample Customer", "--phone", "9735550100",
          "--address", "123 Main St", "--date", "2026-07-20", "--start", "09:00",
          "--end", "11:00", "--description", "Cleanout", value, "--json"
        ], baseUrl),
        (error) => {
          assert.equal(error.code, 2);
          assert.equal(JSON.parse(error.stderr).error.code, "invalid_input");
          return true;
        }
      );
    }
  });
});

test("invalid booking input exits 2 without calling the API", async () => {
  await withApi((_request, response) => {
    json(response, 500, { error: "should not be called" });
  }, async (baseUrl) => {
    await assert.rejects(
      cli(["book", "--name", "Bad Input", "--json"], baseUrl),
      (error) => {
        assert.equal(error.code, 2);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.error.code, "invalid_input");
        assert.match(payload.error.message, /--phone is required/);
        return true;
      }
    );
  });
});

test("HTTP 409 maps to a typed conflict and exit 4", async () => {
  await withApi((_request, response) => {
    json(response, 409, { code: "schedule_conflict", message: "Team A is no longer available." });
  }, async (baseUrl) => {
    await assert.rejects(
      cli([
        "book", "--name", "Sample Customer", "--phone", "9735550100",
        "--address", "123 Main St", "--date", "2026-07-20", "--start", "09:00",
        "--end", "11:00", "--description", "Cleanout", "--yes", "--json"
      ], baseUrl),
      (error) => {
        assert.equal(error.code, 4);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.error.code, "schedule_conflict");
        assert.equal(payload.error.status, 409);
        return true;
      }
    );
  });
});

test("API errors redact configured and token-shaped secrets without losing status or exit typing", async () => {
  const otherToken = `jdsa_${"b".repeat(64)}`;
  await withApi((_request, response) => {
    json(response, 409, {
      code: "schedule_conflict",
      message: `Request with ${validToken} conflicted; diagnostic token ${otherToken}.`,
      details: { authorization: `Bearer ${validToken}`, diagnosticToken: otherToken }
    });
  }, async (baseUrl) => {
    await assert.rejects(
      cli(["slots", "--json"], baseUrl),
      (error) => {
        assert.equal(error.code, 4);
        const payload = JSON.parse(error.stderr);
        assert.equal(payload.error.code, "schedule_conflict");
        assert.equal(payload.error.status, 409);
        assert.equal(payload.error.message, "Request with [REDACTED] conflicted; diagnostic token [REDACTED].");
        assert.doesNotMatch(error.stdout, /jdsa_[a-f0-9]{64}/);
        assert.doesNotMatch(error.stderr, /jdsa_[a-f0-9]{64}/);
        assert.doesNotMatch(error.stdout, new RegExp(validToken));
        assert.doesNotMatch(error.stderr, new RegExp(validToken));
        return true;
      }
    );
  });
});
