# AGENTS.md

## Purpose

JunkDoctors Booking is a dependency-free CLI skill for checking service availability and safely previewing or creating bookings through the authenticated Dash API.

## Agent installation

When a user gives you this file's GitHub URL followed by a `JD_BOOKING_API_TOKEN=<token>` line, complete setup without asking them to repeat the credential or copy it through another channel.

This is a direct credential setup, not a coding task. Do not inspect the workspace, invoke a coding-agent workflow, delegate, search the web, clone a repository, probe Git/GitHub authentication, or install packages. The supplied contract URL is authoritative.

### Required fast path

Complete download, integrity checks, private installation, credential storage, identity verification, and the availability smoke test in one command execution. Download the immutable `setup-v1.0.0` helper, require SHA-256 `a13520bed9dfa44c89c2aed25504c6dd786a73de792d5805f4fa4971351bd478`, and run it with `--expected-agent` set to the agent name from the setup message. Supply only the raw token to that process through non-echoing standard input; never interpolate it into the shell command.

The equivalent shell command is below. Replace only `<expected agent name>` using safe shell quoting, and send the token separately as process stdin:

```bash
install_dir="$HOME/.local/lib/jd-booking"; installer="$install_dir/install-jd-booking"; incoming="$installer.incoming"; mkdir -p "$install_dir" && chmod 700 "$install_dir" && curl -fsSL "https://raw.githubusercontent.com/JunkDoctors/booking-agent/setup-v1.0.0/install-jd-booking" -o "$incoming" && python3 -c 'import hashlib,sys; p=sys.argv[1]; expected=sys.argv[2]; actual=hashlib.sha256(open(p,"rb").read()).hexdigest(); sys.exit(0 if actual == expected else 1)' "$incoming" 'a13520bed9dfa44c89c2aed25504c6dd786a73de792d5805f4fa4971351bd478' && chmod 700 "$incoming" && mv "$incoming" "$installer" && python3 "$installer" --expected-agent '<expected agent name>'
```

The helper reuses an already verified CLI, so token rotation/setup reruns avoid downloading it again. It emits one concise JSON result and fails if the credential resolves to a different agent. Do not repeat its completed checks manually. Use the manual requirements below only if the immutable helper cannot be downloaded or executed, and report the exact blocker.

1. Treat the credential as a secret. Do not quote it back, print it, include it in tool output, place it in a command-line argument, or expose it in an error.
2. Require Python 3.9 or newer. Do not install Node.js, npm packages, or repository dependencies.
3. Download the immutable `v1.0.0` executable from `https://raw.githubusercontent.com/JunkDoctors/booking-agent/v1.0.0/jd-booking` over HTTPS to a temporary file. Before executing it, require SHA-256 `e446bc9bf27bd90d172f4c5078762c4dd4b945d6a42947ffc5da3e5d1b0bd1d3` and run `python3 -m py_compile` against it. Abort on either mismatch or syntax failure.
4. Install it as `~/.local/bin/jd-booking` with mode `0700`, or another private user-local executable directory already on the agent's PATH. Do not require a repository clone or GitHub authentication. Verify the installed file by absolute path. If `command -v jd-booking` fails, persist the private bin directory in the agent runtime's `PATH` or use the absolute path for future calls.
5. Supply the credential through the agent platform's persistent secret/environment facility as `JD_BOOKING_API_TOKEN`. Do not require macOS Keychain, a secure dialog, clipboard access, or another user message.
6. If the platform has no secret facility on macOS or Linux, write only the raw token plus a trailing newline to `~/.jd/booking-token`; make `~/.jd` mode `0700` and the token file mode `0600`. The CLI ignores files with group/other access or the wrong owner. File fallback is disabled on Windows.
7. Do not set an API base unless the user explicitly supplies a non-production target. Production already defaults to `https://www.junkdoctorsnj.com/dash/api/cli`.
8. Verify the finished setup with `jd-booking availability --days 1 --json`. Report success only when it authenticates and returns availability.

The credential in the onboarding message authorizes configuration. Do not stop because a preferred secret store is unavailable, and do not ask the user to paste the same credential again.

## Agent booking behavior

- Use `--json` for automation.
- Resolve relative dates in the JunkDoctors service timezone returned by the API. Check availability before choosing a time.
- If the user asks for a sample or test appointment without fields, use the README sample customer and an available window on the requested date. Preview by default.
- A production test booking is allowed when the user explicitly asks to commit the sample after seeing an exact preview. Do not demand real customer data in that case. Make the record unmistakably synthetic: prefix the customer name with `TEST -`, prefix the description with `[TEST BOOKING - REMOVE]`, and use the README's reserved `555` phone number. Report the created booking ID and remind the user to remove the test record.
- For a real booking, collect genuinely missing customer details, run the preview, and show the proposed customer, address, date, time window, team, and description.
- Obtain explicit confirmation of that exact preview before repeating the command with `--yes`. Never infer confirmation. A request to preview, test, or create a sample is not confirmation to commit a real booking.
- If the user changes any field after preview, including team or time, generate the updated exact preview instead of refusing the test or requesting real customer data. Require confirmation of the updated preview before committing it.
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
- Run `python3 -m unittest -v tests/test_jd_booking.py tests/test_fast_installer.py`, `python3 -m py_compile jd-booking install-jd-booking tests/test_jd_booking.py tests/test_fast_installer.py`, and `git diff --check` before pushing.
- The supported runtime is Python 3.9 or newer using only the standard library.
