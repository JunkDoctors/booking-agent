# JunkDoctors Scheduling CLI

A standalone, safe CLI for finding availability and scheduling JunkDoctors services through the authenticated Dash API.

## Install

```bash
npm install
npm run build
npm link
```

The binary is `jd-schedule`.

## Configuration

The CLI intentionally reuses Dash CLI configuration when available:

```bash
export JD_SCHEDULING_API_TOKEN='...'
# Optional; defaults to https://www.junkdoctorsnj.com/dash/api/cli
export JD_SCHEDULING_API_BASE_URL='https://www.junkdoctorsnj.com/dash/api/cli'
```

Fallbacks are `JD_API_TOKEN`, `JD_API_BASE_URL`, then `~/.jd/config.json`. Tokens are never printed.

## Find slots

```bash
jd-schedule slots
jd-schedule slots --date 2026-07-20 --days 7 --team b --duration 120
jd-schedule slots --booked --json
```

## Book a service

Booking is preview-only unless `--yes` is present.

```bash
jd-schedule book \
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

Review the preview, then repeat with `--yes` to commit. The server rechecks the window inside the write path. A deterministic idempotency key prevents a retry from creating a duplicate; callers may provide `--idempotency-key` explicitly.

## Agent contract

- Use `--json` for automation.
- Exit `0`: success, including dry-run or idempotent replay.
- Exit `1`: network/server failure.
- Exit `2`: invalid CLI input.
- Exit `3`: missing/failed authentication.
- Exit `4`: scheduling conflict.
- Errors are emitted to stderr as `{ "ok": false, "error": { "code", "message", "status"? } }`.

### API

`GET /schedule.php` lists availability using `date`, `days`, `duration`, `step`, `start`, `end`, `team`, `limit`, and `include_booked=1`.

`POST /schedule.php` previews or creates a booking. The JSON body contains the popup-equivalent fields plus `team`, `dryRun`, and `idempotencyKey`. The same key is sent in the `Idempotency-Key` header. A commit must atomically recheck conflicts and return HTTP `409` if the team/window is no longer available.

No production deployment is performed by this repository.
