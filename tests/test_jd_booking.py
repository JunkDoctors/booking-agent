from __future__ import annotations

import json
import os

import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "jd-booking"
VALID_TOKEN = "jdsa_" + "a" * 64


class Handler(BaseHTTPRequestHandler):
    callback: Callable[["Handler", bytes], tuple[Any, ...]] | None = None

    def _handle(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b""
        callback = type(self).callback
        assert callback is not None
        response = callback(self, body)
        status_code, payload = response[:2]
        extra_headers = response[2] if len(response) > 2 else {}
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        for name, value in extra_headers.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(encoded)

    do_GET = _handle
    do_POST = _handle

    def log_message(self, format: str, *args: object) -> None:
        return


@contextmanager
def api(callback: Callable[[Handler, bytes], tuple[Any, ...]]):
    handler_type = type("IsolatedHandler", (Handler,), {"callback": staticmethod(callback)})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler_type)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def run_cli(args: list[str], base_url: str, overrides: dict[str, str | None] | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    for name in (
        "JD_BOOKING_API_TOKEN",
        "JD_SCHEDULING_API_TOKEN",
        "JD_API_TOKEN",
        "JD_BOOKING_API_BASE_URL",
        "JD_SCHEDULING_API_BASE_URL",
    ):
        env.pop(name, None)
    env.update({"JD_BOOKING_API_BASE_URL": base_url, "JD_BOOKING_API_TOKEN": VALID_TOKEN})
    for name, value in (overrides or {}).items():
        if value is None:
            env.pop(name, None)
        else:
            env[name] = value
    return subprocess.run(
        [sys.executable, str(CLI), *args],
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


class BookingCliTests(unittest.TestCase):
    def test_availability_forwards_filters_and_returns_stable_json(self) -> None:
        def callback(request: Handler, _body: bytes) -> tuple[int, dict[str, Any]]:
            self.assertEqual(request.headers["Authorization"], f"Bearer {VALID_TOKEN}")
            self.assertIn("date=2026-07-20", request.path)
            self.assertIn("team=b", request.path)
            self.assertIn("include_booked=1", request.path)
            return 200, {
                "availability": [{"date": "2026-07-20", "window": "9am - 11am", "team": "Team B", "teamKey": "b", "available": True, "conflicts": []}],
                "booked": [],
                "meta": {"timezone": "America/New_York", "actor": {"agentUserId": "agent00001", "displayName": "Booker One"}},
            }

        with api(callback) as base_url:
            result = run_cli(["availability", "--date", "2026-07-20", "--team", "b", "--booked", "--json"], base_url)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["command"], "availability")
        self.assertEqual(payload["data"]["availability"][0]["teamKey"], "b")

    def test_missing_token_ignores_unrelated_legacy_shared_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            jd = Path(home) / ".jd"
            jd.mkdir()
            (jd / "config.json").write_text(json.dumps({"apiToken": "legacy-config-token"}), encoding="utf-8")
            result = run_cli(
                ["availability", "--json"],
                "http://127.0.0.1:1",
                {"HOME": home, "JD_BOOKING_API_TOKEN": None, "JD_API_TOKEN": "legacy-shared-token"},
            )
        self.assertEqual(result.returncode, 3)
        self.assertEqual(json.loads(result.stderr)["error"]["code"], "auth_missing")
        self.assertNotIn("legacy-", result.stderr)

    @unittest.skipIf(os.name == "nt", "POSIX owner/mode contract")
    def test_owner_only_booking_token_file_authenticates(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            jd = Path(home) / ".jd"
            jd.mkdir()
            token_file = jd / "booking-token"
            token_file.write_text(VALID_TOKEN + "\n", encoding="utf-8")
            token_file.chmod(0o600)

            def callback(request: Handler, _body: bytes) -> tuple[int, dict[str, Any]]:
                self.assertEqual(request.headers["Authorization"], f"Bearer {VALID_TOKEN}")
                return 200, {"availability": [], "booked": [], "meta": {"actor": {"agentUserId": "a", "displayName": "A"}}}

            with api(callback) as base_url:
                result = run_cli(["availability", "--json"], base_url, {"HOME": home, "JD_BOOKING_API_TOKEN": None})
        self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipIf(os.name == "nt", "POSIX owner/mode contract")
    def test_empty_environment_value_disables_file_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            jd = Path(home) / ".jd"
            jd.mkdir()
            token_file = jd / "booking-token"
            token_file.write_text(VALID_TOKEN + "\n", encoding="utf-8")
            token_file.chmod(0o600)
            result = run_cli(["availability", "--json"], "http://127.0.0.1:1", {"HOME": home, "JD_BOOKING_API_TOKEN": ""})
        self.assertEqual(result.returncode, 3)
        self.assertEqual(json.loads(result.stderr)["error"]["code"], "auth_missing")

    @unittest.skipIf(os.name == "nt", "POSIX owner/mode contract")
    def test_insecure_token_file_is_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            jd = Path(home) / ".jd"
            jd.mkdir()
            token_file = jd / "booking-token"
            token_file.write_text(VALID_TOKEN + "\n", encoding="utf-8")
            token_file.chmod(0o644)
            result = run_cli(["availability", "--json"], "http://127.0.0.1:1", {"HOME": home, "JD_BOOKING_API_TOKEN": None})
        self.assertEqual(result.returncode, 3)
        self.assertNotIn(VALID_TOKEN, result.stderr)

    def test_legacy_scheduling_environment_token_remains_compatible(self) -> None:
        def callback(request: Handler, _body: bytes) -> tuple[int, dict[str, Any]]:
            self.assertEqual(request.headers["Authorization"], f"Bearer {VALID_TOKEN}")
            return 200, {"availability": [], "booked": [], "meta": {"actor": {"agentUserId": "a", "displayName": "A"}}}

        with api(callback) as base_url:
            result = run_cli(
                ["availability", "--json"],
                base_url,
                {"JD_BOOKING_API_TOKEN": None, "JD_SCHEDULING_API_TOKEN": VALID_TOKEN},
            )
        self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipIf(os.name == "nt", "POSIX owner/mode contract")
    def test_legacy_scheduling_token_file_remains_compatible(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            jd = Path(home) / ".jd"
            jd.mkdir()
            token_file = jd / "scheduling-token"
            token_file.write_text(VALID_TOKEN + "\n", encoding="utf-8")
            token_file.chmod(0o600)

            def callback(request: Handler, _body: bytes) -> tuple[int, dict[str, Any]]:
                self.assertEqual(request.headers["Authorization"], f"Bearer {VALID_TOKEN}")
                return 200, {"availability": [], "booked": [], "meta": {"actor": {"agentUserId": "a", "displayName": "A"}}}

            with api(callback) as base_url:
                result = run_cli(
                    ["availability", "--json"],
                    base_url,
                    {"HOME": home, "JD_BOOKING_API_TOKEN": None},
                )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_malformed_token_fails_without_calling_api_or_printing_token(self) -> None:
        malformed = "jdsa_" + "A" * 64
        result = run_cli(["availability", "--json"], "http://127.0.0.1:1", {"JD_BOOKING_API_TOKEN": malformed})
        self.assertEqual(result.returncode, 3)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["error"]["code"], "auth_invalid")
        self.assertNotIn(malformed, result.stderr)

    def test_generic_legacy_api_base_sources_are_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as home:
            jd = Path(home) / ".jd"
            jd.mkdir()
            (jd / "config.json").write_text(json.dumps({"apiBaseUrl": "http://attacker.invalid"}), encoding="utf-8")
            malformed = "jdsa_" + "A" * 64
            result = run_cli(
                ["availability", "--json"],
                "http://127.0.0.1:1",
                {
                    "HOME": home,
                    "JD_BOOKING_API_BASE_URL": None,
                    "JD_API_BASE_URL": "http://attacker.invalid",
                    "JD_BOOKING_API_TOKEN": malformed,
                },
            )
        self.assertEqual(result.returncode, 3)
        self.assertEqual(json.loads(result.stderr)["error"]["code"], "auth_invalid")

    def test_non_loopback_http_api_base_is_rejected_before_request(self) -> None:
        result = run_cli(
            ["availability", "--json"],
            "http://attacker.invalid/path",
            {"JD_BOOKING_API_TOKEN": VALID_TOKEN},
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stderr)["error"]["code"], "invalid_input")

    def test_explicit_empty_new_api_base_suppresses_legacy_base(self) -> None:
        malformed = "jdsa_" + "A" * 64
        result = run_cli(
            ["availability", "--json"],
            "http://127.0.0.1:1",
            {
                "JD_BOOKING_API_BASE_URL": "",
                "JD_SCHEDULING_API_BASE_URL": "http://attacker.invalid/path",
                "JD_BOOKING_API_TOKEN": malformed,
            },
        )
        self.assertEqual(result.returncode, 3)
        self.assertEqual(json.loads(result.stderr)["error"]["code"], "auth_invalid")

    def test_redirect_is_not_followed_with_authorization(self) -> None:
        captured = {"count": 0}
        base_ref = {"url": ""}

        def callback(request: Handler, _body: bytes) -> tuple[Any, ...]:
            if request.path == "/capture":
                captured["count"] += 1
                return 200, {"availability": [], "booked": [], "meta": {}}
            return 302, {"message": "redirect"}, {"Location": base_ref["url"] + "/capture"}

        with api(callback) as base_url:
            base_ref["url"] = base_url
            result = run_cli(["availability", "--json"], base_url)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(captured["count"], 0)
        self.assertEqual(json.loads(result.stderr)["error"]["status"], 302)

    def test_non_object_auth_error_keeps_auth_exit_classification(self) -> None:
        with api(lambda _request, _body: (401, ["Unauthorized"])) as base_url:
            result = run_cli(["availability", "--json"], base_url)
        self.assertEqual(result.returncode, 3)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["error"]["code"], "unauthorized")
        self.assertEqual(payload["error"]["status"], 401)

    def test_help_uses_junkdoctors_booking_names(self) -> None:
        result = run_cli(["--help"], "http://127.0.0.1:1")
        self.assertEqual(result.returncode, 0)
        self.assertIn("JunkDoctors Booking", result.stdout)
        self.assertIn("jd-booking", result.stdout)
        self.assertNotIn("Node", result.stdout)
        self.assertNotIn("JD_SCHEDULING_API_TOKEN", result.stdout)

    def test_legacy_command_shim_runs_the_new_cli(self) -> None:
        result = subprocess.run(
            [str(ROOT / "bin" / "jd-schedule"), "--help"],
            cwd=ROOT,
            env=os.environ.copy(),
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("JunkDoctors Booking", result.stdout)
        self.assertIn("renamed to jd-booking", result.stderr)

    def test_legacy_command_preserves_default_source_and_idempotency_key(self) -> None:
        def callback(_request: Handler, body: bytes) -> tuple[int, dict[str, Any]]:
            payload = json.loads(body)
            self.assertEqual(payload["source"], "Scheduling CLI")
            self.assertEqual(payload["idempotencyKey"], "4d58c3d9dac62deec2821f8f65f96230")
            return 200, {
                "ok": True,
                "dryRun": True,
                "changed": True,
                "idempotencyKey": payload["idempotencyKey"],
                "booking": {**payload, "team": "Team A"},
                "actor": {"agentUserId": "a", "displayName": "A"},
            }

        with api(callback) as base_url:
            env = os.environ.copy()
            env.update({"JD_BOOKING_API_BASE_URL": base_url, "JD_BOOKING_API_TOKEN": VALID_TOKEN})
            result = subprocess.run(
                [
                    str(ROOT / "bin" / "jd-schedule"), "book", "--name", "Sample Customer",
                    "--phone", "9735550100", "--address", "123 Main St", "--date", "2026-07-20",
                    "--start", "09:00", "--end", "11:00", "--description", "Cleanout", "--json",
                ],
                cwd=ROOT,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_book_defaults_to_preview_and_sends_expected_fields(self) -> None:
        def callback(request: Handler, body: bytes) -> tuple[int, dict[str, Any]]:
            self.assertEqual(request.command, "POST")
            payload = json.loads(body)
            self.assertTrue(payload["dryRun"])
            self.assertEqual(payload["phone"], "973-555-0100")
            self.assertEqual(payload["source"], "Phone")
            self.assertEqual(payload["idempotencyKey"], "3f6009e6c3e5d29b08d9cb58c4f1b1dd")
            self.assertEqual(request.headers["Idempotency-Key"], payload["idempotencyKey"])
            return 200, {"ok": True, "dryRun": True, "changed": True, "idempotencyKey": payload["idempotencyKey"], "booking": {**payload, "team": "Team A", "window": "9am - 11am"}, "actor": {"agentUserId": "a", "displayName": "A"}}

        with api(callback) as base_url:
            result = run_cli([
                "book", "--name", "Sample Customer", "--phone", "(973) 555-0100",
                "--address", "123 Main St, Sparta, NJ 07871", "--date", "2026-07-20",
                "--start", "09:00", "--end", "11:00", "--description", "Basement cleanout",
                "--source", "Phone", "--json",
            ], base_url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["data"]["dryRun"])

    def test_yes_is_only_commit_switch(self) -> None:
        def callback(_request: Handler, body: bytes) -> tuple[int, dict[str, Any]]:
            payload = json.loads(body)
            self.assertFalse(payload["dryRun"])
            return 201, {"ok": True, "dryRun": False, "changed": True, "idempotencyKey": payload["idempotencyKey"], "booking": {**payload, "jobId": "job_123", "team": "Team C"}, "actor": {"agentUserId": "a", "displayName": "A"}}

        with api(callback) as base_url:
            result = run_cli([
                "book", "--name", "Sample Customer", "--phone", "9735550100", "--address", "123 Main St",
                "--date", "2026-07-20", "--start", "13:00", "--end", "15:00",
                "--description", "Garage cleanout", "--team", "c", "--yes",
            ], base_url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("BOOKING CREATED", result.stdout)
        self.assertIn("Job ID: job_123", result.stdout)

    def test_boolean_value_cannot_masquerade_as_confirmation(self) -> None:
        result = run_cli([
            "book", "--name", "Sample", "--phone", "9735550100", "--address", "123 Main St",
            "--date", "2026-07-20", "--start", "09:00", "--end", "11:00", "--description", "Cleanout",
            "--yes=false", "--json",
        ], "http://127.0.0.1:1")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stderr)["error"]["code"], "invalid_input")

    def test_invalid_booking_input_exits_two_without_api_call(self) -> None:
        result = run_cli(["book", "--name", "Bad Input", "--json"], "http://127.0.0.1:1")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stderr)["error"]["code"], "invalid_input")

    def test_http_conflict_maps_to_exit_four(self) -> None:
        with api(lambda _request, _body: (409, {"code": "schedule_conflict", "message": "Team A is no longer available."})) as base_url:
            result = run_cli(["availability", "--json"], base_url)
        self.assertEqual(result.returncode, 4)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["error"]["code"], "schedule_conflict")
        self.assertEqual(payload["error"]["status"], 409)

    def test_api_errors_redact_configured_and_token_shaped_secrets(self) -> None:
        other_token = "jdsa_" + "b" * 64
        with api(lambda _request, _body: (409, {"code": "schedule_conflict", "message": f"{VALID_TOKEN} conflicted with {other_token}"})) as base_url:
            result = run_cli(["availability", "--json"], base_url)
        self.assertEqual(result.returncode, 4)
        self.assertNotIn(VALID_TOKEN, result.stderr)
        self.assertNotIn(other_token, result.stderr)
        self.assertIn("[REDACTED]", result.stderr)


if __name__ == "__main__":
    unittest.main()
