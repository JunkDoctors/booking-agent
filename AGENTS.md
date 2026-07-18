# AGENTS.md

## Purpose

Standalone JunkDoctors scheduling CLI. It lists service availability and books services through the authenticated Dash scheduling API.

## Agent installation

When a user gives you this file's GitHub URL followed by a
`JD_SCHEDULING_API_TOKEN=<token>` line, complete setup without asking them to repeat
the credential or copy it through another channel.

1. Treat the value as a secret. Do not quote it back, print it, include it in
   tool output, or place it in a command-line argument. Redact it from errors.
2. Use the public repository at
   `https://github.com/JunkDoctors/scheduling-cli.git`. Do not require GitHub
   authentication. Clone it with HTTPS. Before reusing an existing checkout,
   verify that `remote.origin.url` resolves to that exact repository and that
   there are no unexpected local changes; otherwise use a fresh checkout.
   Fetch and build the trusted `origin/main` revision.
3. Verify Node.js 20 or newer, then run `npm ci` and `npm run build` in the
   checkout.
4. Make `jd-schedule` available to the agent. Prefer `npm link`; if global npm
   linking is unavailable, use the checkout's `bin/jd-schedule` directly or
   create a user-local link under `~/.local/bin`.
5. Supply the credential as `JD_SCHEDULING_API_TOKEN` through the agent
   platform's persistent secret/environment facility. Do not require macOS
   Keychain, a secure dialog, clipboard access, or another user message. If the
   platform has no secret facility on macOS or Linux, write only the raw token
   plus a trailing newline to `~/.jd/scheduling-token` and set that file to
   owner-only mode (`0600`). The CLI loads this file only when the environment
   variable is absent and the file is owned by the current user with no
   group/other access. The file fallback is disabled on Windows; use the
   platform's secret/environment facility there.
6. Do not set an API base unless the user explicitly supplies one. Production
   already defaults to `https://www.junkdoctorsnj.com/dash/api/cli`.
7. Verify the finished setup with `jd-schedule slots --days 1 --json`. Report
   success only when the command authenticates and returns availability.

The credential in the onboarding message is authorization to configure this
CLI. Do not stop merely because a preferred secret store is unavailable, and
do not ask the user to paste the same credential again.

## Agent booking behavior

- Use `--json` for automation.
- Resolve relative dates in the JunkDoctors service timezone returned by the
  API. Check availability before choosing a time.
- If the user asks for a sample or test appointment without providing fields,
  use the README sample customer details and an available window on the
  requested date. Run a preview only; do not create a real booking.
- For a real booking, collect any genuinely missing customer details, run the
  preview, and show the proposed customer, address, date, time window, team,
  and description.
- Obtain explicit confirmation of that preview before repeating the command
  with `--yes`. Never infer confirmation. A request to preview or create a
  sample is not confirmation to commit a real booking.

## Safety

- Booking is dry-run by default. Only `--yes` may commit.
- Never log, print, fixture, or commit API tokens or customer data.
- Preserve idempotency keys and server-side conflict checks for all writes.
- Do not add direct database access.
- Do not deploy production.

## Workflow

- Do not work directly on `main` after repository initialization.
- Keep CLI and dashboard API changes in separate repositories and PRs.
- Run `npm test` and `git diff --check` before pushing.
- Node.js 20+ is required.
