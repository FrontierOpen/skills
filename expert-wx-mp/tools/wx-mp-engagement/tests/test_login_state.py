import importlib.util
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch_engagement.py"
spec = importlib.util.spec_from_file_location("fetch_engagement", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class LoginStateTests(unittest.TestCase):
    def test_home_callback_requires_cgi_bin_home_and_token(self):
        self.assertTrue(mod.is_authenticated_home_url(
            "https://mp.weixin.qq.com/cgi-bin/home?t=home/index&token=123456&lang=zh_CN"
        ))
        self.assertFalse(mod.is_authenticated_home_url("https://mp.weixin.qq.com/"))
        self.assertFalse(mod.is_authenticated_home_url(
            "https://mp.weixin.qq.com/cgi-bin/home?t=home/index"
        ))
        self.assertFalse(mod.is_authenticated_home_url(
            "https://mp.weixin.qq.com/cgi-bin/appmsgpublish?token=123456"
        ))

    def test_login_urls_are_never_authenticated(self):
        self.assertTrue(mod.is_login_url("https://mp.weixin.qq.com/cgi-bin/loginpage"))
        self.assertTrue(mod.is_login_url("https://mp.weixin.qq.com/scanloginqrcode"))
        self.assertFalse(mod.is_authenticated_home_url(
            "https://mp.weixin.qq.com/cgi-bin/home?token=123456&next=login"
        ))

    def test_confirm_window_is_longer_than_single_redirect_tick(self):
        self.assertGreaterEqual(mod.LOGIN_CONFIRM_SETTLE_MAX_S, 45)
        self.assertLessEqual(mod.LOGIN_CONFIRM_POLL_INTERVAL_S, 2)

    def test_stale_parentlock_is_removed_only_without_daemon_socket(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_lock = mod.SESSION_LOCK_PATH
            old_socket = mod.SESSION_SOCKET_PATH
            try:
                profile = Path(tmp) / "profile"
                profile.mkdir()
                (profile / ".parentlock").write_text("stale")
                mod.SESSION_LOCK_PATH = profile / ".wx-mp-engagement.lock"
                mod.SESSION_SOCKET_PATH = Path(tmp) / "missing.sock"
                with patch.object(mod.subprocess, "run", return_value=type("R", (), {"stdout": ""})()):
                    mod._cleanup_orphaned_session_processes()
                self.assertFalse((profile / ".parentlock").exists())
            finally:
                mod.SESSION_LOCK_PATH = old_lock
                mod.SESSION_SOCKET_PATH = old_socket

    def test_session_lock_is_profile_local_and_reusable(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_path = mod.SESSION_LOCK_PATH
            try:
                mod.SESSION_LOCK_PATH = Path(tmp) / "profile" / ".wx-mp-engagement.lock"
                with mod.session_lock(timeout=0.1):
                    self.assertTrue(mod.SESSION_LOCK_PATH.exists())
                # flock is released automatically at command scope.
                with mod.session_lock(timeout=0.1):
                    pass
            finally:
                mod.SESSION_LOCK_PATH = old_path


if __name__ == "__main__":
    unittest.main()
