#!/usr/bin/env python3
"""Entry-point tests for publish_wx_mp.py; all calls are mocked, so no API request is made."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "scripts" / "publish_wx_mp.py"
SPEC = importlib.util.spec_from_file_location("publish_wx_mp_cli", SCRIPT)
assert SPEC and SPEC.loader
cli = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cli)


class PublishWxMpCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.markdown = Path(self.tempdir.name) / "article.md"
        self.markdown.write_text("---\ntitle: test\ncover: cover.jpg\n---\nbody", encoding="utf-8")

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def invoke(self, *args: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with patch.object(sys, "argv", [str(SCRIPT), str(self.markdown), *args]), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                cli.main()
            except SystemExit as exc:
                return int(exc.code or 0), out.getvalue(), err.getvalue()
        return 0, out.getvalue(), err.getvalue()

    def test_direct_debug_schema_is_forwarded_without_sensitive_arguments(self) -> None:
        captured: dict[str, object] = {}

        def fake_run(cmd, check, env):
            captured["cmd"] = cmd
            captured["env"] = env
            return subprocess.CompletedProcess(cmd, 0)

        with patch.object(cli.subprocess, "run", side_effect=fake_run):
            code, stdout, stderr = self.invoke(
                "--transport", "direct", "--account", "private-alias",
                "--update-media-id", "private-media-id", "--debug-schema",
            )

        self.assertEqual(code, 0)
        self.assertEqual(stdout, "")
        self.assertEqual(stderr, "")
        self.assertEqual(
            captured["cmd"],
            ["node", str(HERE.parent / "scripts" / "direct_wx_mp.mjs"), str(self.markdown),
             "--transport", "direct", "--account", "private-alias",
             "--update-media-id", "private-media-id", "--debug-schema"],
        )
        # The Python entrypoint never reads accounts or injects secrets into argv.
        self.assertNotIn("appSecret", " ".join(captured["cmd"]))
        self.assertNotIn("very-secret", " ".join(captured["cmd"]))
        self.assertNotIn("very-secret", stdout + stderr)

    def test_defaults_to_direct_transport(self) -> None:
        captured: dict[str, object] = {}

        def fake_run(cmd, check, env):
            captured["cmd"] = cmd
            captured["env"] = env
            return subprocess.CompletedProcess(cmd, 0)

        with patch.object(cli.subprocess, "run", side_effect=fake_run):
            code, stdout, stderr = self.invoke()

        self.assertEqual(code, 0)
        self.assertEqual(stdout, "")
        self.assertEqual(stderr, "")
        self.assertEqual(
            captured["cmd"],
            ["node", str(HERE.parent / "scripts" / "direct_wx_mp.mjs"), str(self.markdown), "--transport", "direct"],
        )

    def test_relay_transport_is_rejected(self) -> None:
        code, stdout, stderr = self.invoke("--transport", "relay", "--debug-schema")

        self.assertEqual(code, 2)
        self.assertEqual(stdout, "")
        self.assertIn("invalid choice: 'relay'", stderr)


if __name__ == "__main__":
    unittest.main()
