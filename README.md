# JunkDoctors Booking

A dependency-free command-line client for checking JunkDoctors availability and safely previewing or creating bookings through the authenticated Dash API.

## Install

AI agents should follow the complete installation and booking contract in [AGENTS.md](./AGENTS.md). Dash Agent Skills links directly to that file and supplies a separate per-agent credential.

The only runtime dependency is Python 3.9 or newer. Install the single executable:

```sh
set -eu
install -d -m 700 "$HOME/.local/bin"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT HUP INT TERM
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/JunkDoctors/booking-agent/v1.0.0/jd-booking \
  -o "$tmp"
python3 -c 'import hashlib,sys; sys.exit(0 if hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest() == sys.argv[2] else 1)' \
  "$tmp" e446bc9bf27bd90d172f4c5078762c4dd4b945d6a42947ffc5da3e5d1b0bd1d3
python3 -m py_compile "$tmp"
install -m 700 "$tmp" "$HOME/.local/bin/jd-booking"
rm -f "$tmp"
trap - EXIT HUP INT TERM
"$HOME/.local/bin/jd-booking" --help
```

No repository clone, Node.js, npm, build, or global package link is required.
Add `~/.local/bin` to the agent runtime's persistent `PATH` when it is not
already available, or invoke the installed executable by its absolute path.

## Configuration

Create or rotate an agent in Dash Agent Skills, then supply its credential as:

```bash
export JD_BOOKING_API_TOKEN='<per-agent token from Agent Skills>'
```

The token is the literal `jdsa_` prefix followed by exactly 64 lowercase hexadecimal characters. The CLI validates the format before making a request and never prints it.

For agent environments without persistent secret storage, the raw token may instead be saved in `~/.jd/booking-token`. On macOS and Linux, the file must be owned by the current user with mode `0600`. The file fallback is disabled on Windows. An explicitly present `JD_BOOKING_API_TOKEN`, including an empty value, takes precedence over the file.

The production API defaults to `https://www.junkdoctorsnj.com/dash/api/cli`. `JD_BOOKING_API_BASE_URL` is available for tests and explicit non-production targets.

Existing installations may transition without immediate reconfiguration: the CLI temporarily accepts `JD_SCHEDULING_API_TOKEN`, `JD_SCHEDULING_API_BASE_URL`, `~/.jd/scheduling-token`, and the `slots` command alias when their new equivalents are absent.

## Availability

```bash
jd-booking availability
jd-booking availability --date 2026-07-20 --days 7 --team b --duration 120
jd-booking availability --booked --json
```

## Preview or create a booking

Booking is preview-only unless `--yes` is present.

```bash
jd-booking book \
  --name "Sample Customer" \
  --phone "973-555-0100" \
  --address "123 Main St, Sparta, NJ 07871" \
  --date 2026-07-20 \
  --start 09:00 \
  --end 11:00 \
  --description "Basement cleanout" \
  --source "Phone" \
  --team a
```

Review the returned preview, then repeat the same command with `--yes` only after explicit confirmation. The server rechecks the window inside the write path. A deterministic idempotency key prevents retries from creating duplicates; callers may provide `--idempotency-key` explicitly.

For an explicitly authorized production-path test, agents may commit the sample only after showing the exact preview. The committed record must use `TEST - Sample Customer`, prefix the description with `[TEST BOOKING - REMOVE]`, retain the reserved `555` sample phone number, and report the booking ID so the test record can be removed. Changing the requested team or time requires a fresh preview and confirmation, not real customer details.

## Command contract

- Use `--json` for automation.
- Exit `0`: success, including preview or idempotent replay.
- Exit `1`: network/server failure.
- Exit `2`: invalid CLI input.
- Exit `3`: missing or failed authentication.
- Exit `4`: booking conflict.
- Errors are emitted to stderr as `{ "ok": false, "error": { "code", "message", "status"? } }`.
- Successful responses include non-secret authenticated actor metadata as `{ "agentUserId", "displayName" }`.

## API

`GET /schedule.php` lists availability. `POST /schedule.php` previews or creates a booking. Both use a per-agent bearer credential. Commit requests include a matching body/header idempotency key, and the server atomically rechecks conflicts.

No production deployment is performed by this repository.
