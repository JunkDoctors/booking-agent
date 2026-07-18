# AGENTS.md

## Purpose

JunkDoctors Booking is a dependency-free CLI skill for checking service availability and safely previewing or creating bookings through the authenticated Dash API.

## Agent installation

When a user gives you this file's GitHub URL followed by a `JD_BOOKING_API_TOKEN=<token>` line, complete setup without asking them to repeat the credential or copy it through another channel.

1. Treat the credential as a secret. Do not quote it back, print it, include it in tool output, place it in a command-line argument, or expose it in an error.
2. Require Python 3.9 or newer. Do not install Node.js, npm packages, or repository dependencies.
3. Download the immutable `v1.0.0` executable from `https://raw.githubusercontent.com/JunkDoctors/booking-agent/v1.0.0/jd-booking` over HTTPS to a temporary file. Before executing it, require SHA-256 `744efe67bd52cbd82c1891955a2fdc18fd3cd3cf2a575341765e5256ac1dfce9` and run `python3 -m py_compile` against it. Abort on either mismatch or syntax failure.
4. Install it as `~/.local/bin/jd-booking` with mode `0700`, or another private user-local executable directory already on the agent's PATH. Do not require a repository clone or GitHub authentication. Verify the installed file by absolute path. If `command -v jd-booking` fails, persist the private bin directory in the agent runtime's `PATH` or use the absolute path for future calls.
5. Supply the credential through the agent platform's persistent secret/environment facility as `JD_BOOKING_API_TOKEN`. Do not require macOS Keychain, a secure dialog, clipboard access, or another user message.
6. If the platform has no secret facility on macOS or Linux, write only the raw token plus a trailing newline to `~/.jd/booking-token`; make `~/.jd` mode `0700` and the token file mode `0600`. The CLI ignores files with group/other access or the wrong owner. File fallback is disabled on Windows.
7. Do not set an API base unless the user explicitly supplies a non-production target. Production already defaults to `https://www.junkdoctorsnj.com/dash/api/cli`.
8. Verify the finished setup with `jd-booking availability --days 1 --json`. Report success only when it authenticates and returns availability.

The credential in the onboarding message authorizes configuration. Do not stop because a preferred secret store is unavailable, and do not ask the user to paste the same credential again.

## Agent booking behavior

- Use `--json` for automation.
- Resolve relative dates in the JunkDoctors service timezone returned by the API. Check availability before choosing a time.
- If the user asks for a sample or test appointment without fields, use the README sample customer and an available window on the requested date. Preview only; never commit a sample booking.
- For a real booking, collect genuinely missing customer details, run the preview, and show the proposed customer, address, date, time window, team, and description.
- Obtain explicit confirmation of that exact preview before repeating the command with `--yes`. Never infer confirmation. A request to preview, test, or create a sample is not confirmation to commit a real booking.
- Preserve idempotency keys on retries. Do not bypass the CLI with handwritten write requests.

## Safety

- Booking is preview-only by default. Only `--yes` may commit.
- Never log, print, fixture, or commit API tokens or customer data.
- Never add direct database access.
- Keep server-side conflict and idempotency protections intact.
- Do not deploy production.

## Contributor workflow

- Do not work directly on `main`.
- Keep CLI and dashboard API changes in separate repositories and PRs.
- Run `python3 -m unittest -v tests/test_jd_booking.py`, `python3 -m py_compile jd-booking tests/test_jd_booking.py`, and `git diff --check` before pushing.
- The supported runtime is Python 3.9 or newer using only the standard library.
