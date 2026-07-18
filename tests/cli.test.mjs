import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("..", import.meta.url);

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

async function cli(args, baseUrl) {
  return execFileAsync("node", ["bin/jd-schedule", ...args], {
    cwd: root,
    env: {
      ...process.env,
      JD_SCHEDULING_API_BASE_URL: baseUrl,
      JD_SCHEDULING_API_TOKEN: "test-token"
    }
  });
}

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

test("slots forwards filters and returns a stable JSON envelope", async () => {
  await withApi((request, response) => {
    assert.equal(request.headers.authorization, "Bearer test-token");
    const url = new URL(request.url, "http://localhost");
    assert.equal(url.pathname, "/schedule.php");
    assert.equal(url.searchParams.get("date"), "2026-07-20");
    assert.equal(url.searchParams.get("team"), "b");
    assert.equal(url.searchParams.get("include_booked"), "1");
    json(response, 200, {
      availability: [{ date: "2026-07-20", day: "Mon Jul 20", start: "2026-07-20 09:00:00", end: "2026-07-20 11:00:00", window: "9am - 11am", team: "Team B", teamKey: "b", available: true, conflicts: [] }],
      booked: [],
      meta: { timezone: "America/New_York" }
    });
  }, async (baseUrl) => {
    const { stdout } = await cli(["slots", "--date", "2026-07-20", "--team", "b", "--booked", "--json"], baseUrl);
    const output = JSON.parse(stdout);
    assert.equal(output.ok, true);
    assert.equal(output.command, "slots");
    assert.equal(output.data.availability[0].teamKey, "b");
  });
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
      booking: { ...body, team: "Team A", window: "9am - 11am" }
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
      booking: { ...body, jobId: "job_123", team: "Team C" }
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
