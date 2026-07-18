# AGENTS.md

## Purpose

Standalone JunkDoctors scheduling CLI. It lists service availability and books services through the authenticated Dash scheduling API.

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
