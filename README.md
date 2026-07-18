# JunkDoctors Scheduling CLI

A standalone, safe CLI for finding availability and scheduling JunkDoctors services through the authenticated Dash API.

## Install

AI agents should follow the complete installation and booking contract in
[AGENTS.md](./AGENTS.md). A generated Dash onboarding prompt links directly to
that file and supplies the per-agent credential separately.

```bash
npm install
npm run build
npm link
```

The binary is `jd-schedule`.

## Configuration

Create or rotate an agent in Dash **Agent Skills**, then place the credential from the generated prompt in the agent's environment:

```bash
export JD_SCHEDULING_API_TOKEN='<per-agent token from Agent Skills>'
# Optional; defaults to https://www.junkdoctorsnj.com/dash/api/cli
export JD_SCHEDULING_API_BASE_URL='https://www.junkdoctorsnj.com/dash/api/cli'
```

`JD_SCHEDULING_API_TOKEN` is required and must be the per-agent credential issued on Agent Skills: the literal `jdsa_` prefix followed by exactly 64 lowercase hexadecimal characters. The CLI validates this format before making a request and never prints the token. Shared `JD_API_TOKEN` values and the `apiToken` in `~/.jd/config.json` are deliberately ignored for scheduling identity.

For agent environments without a persistent secret store, the raw token may
instead be saved in `~/.jd/scheduling-token`. On macOS and Linux, the CLI uses
that fallback only when the file is owned by the current user and has mode
`0600`. This fallback is disabled on Windows. When the environment variable is
explicitly present, including an empty value, it takes precedence over the
file.

The API base may still fall back to `JD_API_BASE_URL`, the `apiBaseUrl` in `~/.jd/config.json`, and then the production default. Normally no base override is needed; follow the environment instructions in the generated Agent Skills prompt.

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
- Successful responses include non-secret authenticated actor metadata as `{ "agentUserId", "displayName" }`: under `data.meta.actor` for `slots` and `data.actor` for `book`. Credentials and token fragments are never returned.

### API

`GET /schedule.php` lists availability using `date`, `days`, `duration`, `step`, `start`, `end`, `team`, `limit`, and `include_booked=1`. Its `meta.actor` identifies the authenticated agent without exposing secret material.

`POST /schedule.php` previews or creates a booking. The JSON body contains the popup-equivalent fields plus `team`, `dryRun`, and `idempotencyKey`; the response includes non-secret `actor` metadata. The same key is sent in the `Idempotency-Key` header. A commit must atomically recheck conflicts and return HTTP `409` if the team/window is no longer available.

No production deployment is performed by this repository.
