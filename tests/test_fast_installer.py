from __future__ import annotations

import importlib.machinery
import importlib.util
import contextlib
import io
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
LOADER = importlib.machinery.SourceFileLoader("jd_booking_installer", str(ROOT / "install-jd-booking"))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
if SPEC is None:
    raise RuntimeError("Unable to load installer module")
INSTALLER = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(INSTALLER)
VALID_TOKEN = "jdsa_" + "a" * 64


class FastInstallerTests(unittest.TestCase):
    def test_installs_verified_cli_and_reuses_current_copy(self) -> None:
        payload = b"#!/usr/bin/env python3\nprint('ok')\n"
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / ".local" / "bin" / "jd-booking"
            with mock.patch.object(INSTALLER, "CLI_SHA256", INSTALLER.sha256(payload)), mock.patch.object(
                INSTALLER, "download_cli", return_value=payload
            ) as download:
                self.assertEqual(INSTALLER.install_cli(target), "installed")
                self.assertEqual(INSTALLER.install_cli(target), "already-current")
            self.assertEqual(download.call_count, 1)
            self.assertEqual(target.read_bytes(), payload)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o700)

    def test_token_stdin_and_private_write_do_not_print_secret(self) -> None:
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(os.environ, {}, clear=True), mock.patch.object(
            INSTALLER.sys, "stdin", io.StringIO(VALID_TOKEN + "\n")
        ):
            token = INSTALLER.read_token()
            target = Path(directory) / ".jd" / "booking-token"
            INSTALLER.write_private(target, (token + "\n").encode(), 0o600)
            self.assertEqual(target.read_text().strip(), VALID_TOKEN)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(target.parent.stat().st_mode), 0o700)

    def test_verification_requires_expected_agent_identity(self) -> None:
        response = json.dumps({
            "ok": True,
            "command": "availability",
            "data": {"meta": {"actor": {"agentUserId": "agent1", "displayName": "Freddy"}}},
        })
        completed = mock.Mock(returncode=0, stdout=response, stderr="")
        with mock.patch.object(INSTALLER.subprocess, "run", return_value=completed):
            self.assertEqual(INSTALLER.verify(Path("/tmp/jd-booking"), "Freddy"), {"displayName": "Freddy"})
            with contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    INSTALLER.verify(Path("/tmp/jd-booking"), "Other Agent")

    def test_failed_identity_check_restores_previous_token(self) -> None:
        previous = "jdsa_" + "b" * 64
        replacement = "jdsa_" + "c" * 64
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            token_file = home / ".jd" / "booking-token"
            INSTALLER.write_private(token_file, (previous + "\n").encode(), 0o600)
            with mock.patch.object(INSTALLER, "verify", side_effect=SystemExit(1)):
                with self.assertRaises(SystemExit):
                    INSTALLER.configure_token(home, Path("/tmp/jd-booking"), replacement, "Freddy")
            self.assertEqual(token_file.read_text().strip(), previous)
            self.assertEqual(stat.S_IMODE(token_file.stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
