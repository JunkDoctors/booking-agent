from __future__ import annotations

import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED = "e446bc9bf27bd90d172f4c5078762c4dd4b945d6a42947ffc5da3e5d1b0bd1d3"


class InstallContractTests(unittest.TestCase):
    def test_published_checksum_matches_executable_and_contracts(self) -> None:
        actual = hashlib.sha256((ROOT / "jd-booking").read_bytes()).hexdigest()
        self.assertEqual(actual, EXPECTED)
        self.assertEqual((ROOT / "SHA256SUMS").read_text(encoding="utf-8"), f"{EXPECTED}  jd-booking\n")
        for name in ("README.md", "AGENTS.md"):
            source = (ROOT / name).read_text(encoding="utf-8")
            self.assertIn("v1.0.0/jd-booking", source)
            self.assertIn(EXPECTED, source)
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertLess(readme.index("set -eu"), readme.index("curl --proto"))
        self.assertLess(readme.index("trap 'rm -f"), readme.index("curl --proto"))

    def test_checksum_failure_stops_before_install(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            download = root / "download"
            marker = root / "installed"
            download.write_text("tampered\n", encoding="utf-8")
            command = f"""
set -eu
tmp={str(download)!r}
trap 'rm -f "$tmp"' EXIT HUP INT TERM
python3 -c 'import hashlib,sys; sys.exit(0 if hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest() == sys.argv[2] else 1)' "$tmp" {EXPECTED}
touch {str(marker)!r}
"""
            result = subprocess.run(["sh", "-c", command], text=True, capture_output=True, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
