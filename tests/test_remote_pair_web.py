#!/usr/bin/env python3
"""
White-box unit tests for client/remote-pair-web (HTTP<->CLI bridge).
python3 stdlib only — no pip dependencies.

Run:
  cd /Users/ghyeong/Spaces/Work/Devs/Lang-Swift/remote-pair
  python3 -m unittest tests.test_remote_pair_web -v
"""

import importlib.util
import json
import pathlib
import secrets
import tempfile
import time
import unittest
import unittest.mock
import urllib.error

# ── Load module (no .py extension, hyphenated filename) ──────────────────────
# spec_from_file_location returns None for extension-less files; use
# SourceFileLoader directly so Python treats the file as plain source.
import importlib.machinery

_BRIDGE = pathlib.Path(__file__).resolve().parent.parent / "client" / "remote-pair-web"
_loader = importlib.machinery.SourceFileLoader("rpw", str(_BRIDGE))
spec = importlib.util.spec_from_loader("rpw", _loader)
rpw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rpw)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fresh_ts():
    return int(time.time())


def _stale_ts():
    return int(time.time()) - rpw.STALE_SECS - 5


def _write_status(path, **kwargs):
    """Write a status.json to *path* (a pathlib.Path to the file, not its dir)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(kwargs))


# ── 1) api_regrant() ──────────────────────────────────────────────────────────

class TestApiRegrant(unittest.TestCase):

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._tmp = pathlib.Path(self._tmpdir.name)
        self._status = self._tmp / "logs" / "status.json"
        self._client_env = self._tmp / "client.env"
        self._role = self._tmp / "role"

    def tearDown(self):
        self._tmpdir.cleanup()

    def _patch(self):
        return unittest.mock.patch.multiple(
            rpw,
            STATUS_FILE=self._status,
            CLIENT_ENV=self._client_env,
            ROLE_FILE=self._role,
        )

    # NOTE: bundle-id 통일(com.x10lab.remote-pair)은 v0.5.0 으로 DEFERRED.
    # 현재 active expected id 는 출하 id 인 'com.x10lab.remote-pair-host'.
    # live host(-host, ax/sr true)는 needed=False 여야 한다.

    # 1a) Current (-host) bundle_id + ax/sr true → needed False
    def test_current_host_id_all_grants_ok(self):
        _write_status(
            self._status,
            bundle_id="com.x10lab.remote-pair-host",
            ax=True,
            sr=True,
            fda=True,
            ts=_fresh_ts(),
        )
        with self._patch():
            result = rpw.api_regrant()
        self.assertFalse(result["needed"])

    # 1b) bundle_id != EXPECTED (future unified id, not yet active) → needed True
    def test_unexpected_bundle_id_needs_regrant(self):
        _write_status(
            self._status,
            bundle_id="com.x10lab.remote-pair",  # 0.5 통일 id — 아직 active 아님
            ax=True,
            sr=True,
            fda=True,
            ts=_fresh_ts(),
        )
        with self._patch():
            result = rpw.api_regrant()
        self.assertTrue(result["needed"])
        self.assertEqual(result.get("bundleId", ""), "com.x10lab.remote-pair")

    # 1b-alt) some other unexpected id → needed True
    def test_other_bundle_id_needs_regrant(self):
        _write_status(
            self._status,
            bundle_id="com.example.something-else",
            ax=True,
            sr=True,
            fda=True,
            ts=_fresh_ts(),
        )
        with self._patch():
            result = rpw.api_regrant()
        self.assertTrue(result["needed"])

    # 1c) Current (-host) id but ax=False (fresh ts) → needed True
    def test_current_host_id_ax_false_needs_regrant(self):
        _write_status(
            self._status,
            bundle_id="com.x10lab.remote-pair-host",
            ax=False,
            sr=True,
            fda=True,
            ts=_fresh_ts(),
        )
        with self._patch():
            result = rpw.api_regrant()
        self.assertTrue(result["needed"])

    # 1d) No status.json → needed False (clean no-op, no bundleId leakage)
    def test_no_status_json_needed_false(self):
        # Do NOT create the file
        with self._patch():
            result = rpw.api_regrant()
        self.assertFalse(result["needed"])
        # absent status → no bundleId echoed
        self.assertEqual(result.get("bundleId", ""), "")


# ── 2) compute_liveness() ─────────────────────────────────────────────────────

class TestComputeLiveness(unittest.TestCase):

    def test_fresh_ts_app_up(self):
        status = {"ts": _fresh_ts(), "ax": True, "sr": True}
        app_up, age = rpw.compute_liveness(status)
        self.assertTrue(app_up)
        self.assertIsNotNone(age)
        self.assertLessEqual(age, rpw.STALE_SECS)

    def test_stale_ts_app_down(self):
        status = {"ts": _stale_ts(), "ax": True, "sr": True}
        app_up, age = rpw.compute_liveness(status)
        self.assertFalse(app_up)
        self.assertGreater(age, rpw.STALE_SECS)

    def test_none_status_returns_false_none(self):
        app_up, age = rpw.compute_liveness(None)
        self.assertFalse(app_up)
        self.assertIsNone(age)

    def test_empty_dict_returns_false(self):
        # ts defaults to 0, which is always stale
        app_up, age = rpw.compute_liveness({})
        self.assertFalse(app_up)


# ── 3) api_status() ───────────────────────────────────────────────────────────

class TestApiStatus(unittest.TestCase):

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._tmp = pathlib.Path(self._tmpdir.name)
        self._status = self._tmp / "logs" / "status.json"
        self._client_env = self._tmp / "client.env"
        self._role = self._tmp / "role"

    def tearDown(self):
        self._tmpdir.cleanup()

    def _patch(self):
        return unittest.mock.patch.multiple(
            rpw,
            STATUS_FILE=self._status,
            CLIENT_ENV=self._client_env,
            ROLE_FILE=self._role,
        )

    def test_fresh_status_with_env_maps_and_host(self):
        _write_status(
            self._status,
            bundle_id="com.x10lab.remote-pair",
            ax=True,
            sr=True,
            fda=False,
            version="0.4.12",
            ts=_fresh_ts(),
        )
        self._client_env.write_text(
            "REMOTE_HOST=myhost\nFOLDER_MAPS=a::b;c;d::e\n"
        )
        with self._patch():
            result = rpw.api_status()

        self.assertTrue(result["appUp"])
        self.assertTrue(result["ax"])
        self.assertTrue(result["sr"])
        self.assertFalse(result["fda"])
        self.assertEqual(result["host"], "myhost")
        self.assertEqual(result["maps"], [
            {"client": "a", "host": "b"},
            {"client": "c", "host": "c"},
            {"client": "d", "host": "e"},
        ])

    def test_stale_status_forces_ax_sr_false_and_app_down(self):
        _write_status(
            self._status,
            bundle_id="com.x10lab.remote-pair",
            ax=True,
            sr=True,
            fda=True,
            version="0.4.12",
            ts=_stale_ts(),
        )
        with self._patch():
            result = rpw.api_status()

        self.assertFalse(result["appUp"])
        self.assertFalse(result["ax"])
        self.assertFalse(result["sr"])
        self.assertFalse(result["fda"])

    def test_no_status_file_defaults(self):
        with self._patch():
            result = rpw.api_status()

        self.assertFalse(result["appUp"])
        self.assertFalse(result["ax"])
        self.assertFalse(result["sr"])
        self.assertEqual(result["maps"], [])
        self.assertEqual(result["host"], "")


# ── 4) parse_client_env() ─────────────────────────────────────────────────────

class TestParseClientEnv(unittest.TestCase):

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._tmp = pathlib.Path(self._tmpdir.name)
        self._client_env = self._tmp / "client.env"

    def tearDown(self):
        self._tmpdir.cleanup()

    def _patch(self):
        return unittest.mock.patch.object(rpw, "CLIENT_ENV", self._client_env)

    def test_basic_key_value(self):
        self._client_env.write_text("KEY=value\n")
        with self._patch():
            result = rpw.parse_client_env()
        self.assertEqual(result["KEY"], "value")

    def test_double_quoted_value(self):
        self._client_env.write_text('KEY="hello world"\n')
        with self._patch():
            result = rpw.parse_client_env()
        self.assertEqual(result["KEY"], "hello world")

    def test_single_quoted_value(self):
        self._client_env.write_text("KEY='hello world'\n")
        with self._patch():
            result = rpw.parse_client_env()
        self.assertEqual(result["KEY"], "hello world")

    def test_comment_lines_skipped(self):
        self._client_env.write_text("# this is a comment\nKEY=val\n")
        with self._patch():
            result = rpw.parse_client_env()
        self.assertNotIn("# this is a comment", result)
        self.assertEqual(result["KEY"], "val")

    def test_blank_lines_skipped(self):
        self._client_env.write_text("\n\nKEY=val\n\n")
        with self._patch():
            result = rpw.parse_client_env()
        self.assertEqual(result, {"KEY": "val"})

    def test_missing_file_returns_empty_dict(self):
        # Do NOT create the file
        with self._patch():
            result = rpw.parse_client_env()
        self.assertEqual(result, {})

    def test_multiple_keys(self):
        self._client_env.write_text(
            "REMOTE_HOST=myhost\n"
            "FOLDER_MAPS=a::b;c::d\n"
            "# comment\n"
            "\n"
            "OTHER=x\n"
        )
        with self._patch():
            result = rpw.parse_client_env()
        self.assertEqual(result["REMOTE_HOST"], "myhost")
        self.assertEqual(result["FOLDER_MAPS"], "a::b;c::d")
        self.assertEqual(result["OTHER"], "x")
        self.assertEqual(len(result), 3)


# ── 5) api_syncthing() ───────────────────────────────────────────────────────

class TestApiSyncthing(unittest.TestCase):

    # 5a) URLError (connection refused, not installed) → detected False
    def test_url_error_not_detected(self):
        url_error = urllib.error.URLError("connection refused")
        with unittest.mock.patch.object(rpw.urllib.request, "urlopen", side_effect=url_error):
            result = rpw.api_syncthing()
        self.assertFalse(result["detected"])
        self.assertEqual(result["status"], "not-detected")

    # 5b) Successful pong → detected True, status up
    def test_pong_response_detected_up(self):
        class _FakeResp:
            def read(self):
                return b'{"ping": "pong"}'
            def __enter__(self):
                return self
            def __exit__(self, *a):
                pass

        with unittest.mock.patch.object(rpw.urllib.request, "urlopen", return_value=_FakeResp()):
            result = rpw.api_syncthing()
        self.assertTrue(result["detected"])
        self.assertEqual(result["status"], "up")

    # 5c) HTTP 403 → running but wrong API key → detected True, status up
    def test_http_403_detected_up(self):
        http_err = urllib.error.HTTPError(
            url=rpw.SYNCTHING_URL,
            code=403,
            msg="Forbidden",
            hdrs=None,
            fp=None,
        )
        with unittest.mock.patch.object(rpw.urllib.request, "urlopen", side_effect=http_err):
            result = rpw.api_syncthing()
        self.assertTrue(result["detected"])
        self.assertEqual(result["status"], "up")

    # 5c-alt) HTTP 401 → also running but wrong API key → detected True
    def test_http_401_detected_up(self):
        http_err = urllib.error.HTTPError(
            url=rpw.SYNCTHING_URL,
            code=401,
            msg="Unauthorized",
            hdrs=None,
            fp=None,
        )
        with unittest.mock.patch.object(rpw.urllib.request, "urlopen", side_effect=http_err):
            result = rpw.api_syncthing()
        self.assertTrue(result["detected"])
        self.assertEqual(result["status"], "up")

    # 5d) HTTP 500 → not detected (not a recognisable "running" state)
    def test_http_500_not_detected(self):
        http_err = urllib.error.HTTPError(
            url=rpw.SYNCTHING_URL,
            code=500,
            msg="Internal Server Error",
            hdrs=None,
            fp=None,
        )
        with unittest.mock.patch.object(rpw.urllib.request, "urlopen", side_effect=http_err):
            result = rpw.api_syncthing()
        self.assertFalse(result["detected"])

    # Never raises
    def test_never_raises_on_generic_exception(self):
        with unittest.mock.patch.object(
            rpw.urllib.request, "urlopen", side_effect=OSError("network down")
        ):
            try:
                result = rpw.api_syncthing()
            except Exception as exc:
                self.fail(f"api_syncthing() raised unexpectedly: {exc}")
        self.assertFalse(result["detected"])


# ── 6) Token / _check_token semantics ────────────────────────────────────────

class TestToken(unittest.TestCase):

    def test_correct_token_matches(self):
        self.assertTrue(secrets.compare_digest(rpw._TOKEN, rpw._TOKEN))

    def test_wrong_token_does_not_match(self):
        wrong = secrets.token_urlsafe(24)
        # Extremely unlikely to be equal; guard just in case
        if wrong == rpw._TOKEN:
            wrong = wrong + "x"
        self.assertFalse(secrets.compare_digest(rpw._TOKEN, wrong))

    def test_empty_token_does_not_match(self):
        # The bridge uses: compare_digest(_TOKEN, token_qs or token_header)
        # When both are empty the expression becomes compare_digest(_TOKEN, "")
        # which should be False (token is non-empty by construction).
        self.assertFalse(secrets.compare_digest(rpw._TOKEN, ""))

    def test_token_is_nonempty(self):
        self.assertGreater(len(rpw._TOKEN), 0)

    # Exercise _check_token with a minimal fake request object
    def test_check_token_correct_qs(self):
        """Correct token in query-string → True."""
        handler = object.__new__(rpw.Handler)
        handler.path = f"/api/status?token={rpw._TOKEN}"
        handler.headers = {"X-Token": ""}
        # Provide a minimal dict-like headers object
        class _Headers(dict):
            def get(self, key, default=""):
                return super().get(key, default)
        handler.headers = _Headers({"X-Token": ""})
        self.assertTrue(handler._check_token())

    def test_check_token_correct_header(self):
        """Correct token in X-Token header → True."""
        handler = object.__new__(rpw.Handler)
        handler.path = "/api/status"
        class _Headers(dict):
            def get(self, key, default=""):
                return super().get(key, default)
        handler.headers = _Headers({"X-Token": rpw._TOKEN})
        self.assertTrue(handler._check_token())

    def test_check_token_bad_token(self):
        """Wrong token in header → False."""
        handler = object.__new__(rpw.Handler)
        handler.path = "/api/status"
        class _Headers(dict):
            def get(self, key, default=""):
                return super().get(key, default)
        handler.headers = _Headers({"X-Token": "bad-token"})
        self.assertFalse(handler._check_token())

    def test_check_token_missing(self):
        """No token at all → False."""
        handler = object.__new__(rpw.Handler)
        handler.path = "/api/status"
        class _Headers(dict):
            def get(self, key, default=""):
                return super().get(key, default)
        handler.headers = _Headers({})
        self.assertFalse(handler._check_token())


# ── 7) api_permissions_open() ────────────────────────────────────────────────

class TestApiPermissionsOpen(unittest.TestCase):

    PANE_URLS = {
        "ax":  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        "sr":  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        "fda": "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
    }

    def _run_ok(self, cmd, timeout=15):
        return "", "", 0

    def _run_fail(self, cmd, timeout=15):
        return "", "open failed", 1

    def test_ax_pane_exact_url(self):
        captured = {}
        def _fake_run(cmd, timeout=15):
            captured["cmd"] = cmd
            return "", "", 0
        with unittest.mock.patch.object(rpw, "run", _fake_run):
            result = rpw.api_permissions_open({"pane": "ax"})
        self.assertEqual(result, {"ok": True, "pane": "ax"})
        self.assertIn(self.PANE_URLS["ax"], captured["cmd"])

    def test_sr_pane_exact_url(self):
        captured = {}
        def _fake_run(cmd, timeout=15):
            captured["cmd"] = cmd
            return "", "", 0
        with unittest.mock.patch.object(rpw, "run", _fake_run):
            result = rpw.api_permissions_open({"pane": "sr"})
        self.assertEqual(result, {"ok": True, "pane": "sr"})
        self.assertIn(self.PANE_URLS["sr"], captured["cmd"])

    def test_fda_pane_exact_url(self):
        captured = {}
        def _fake_run(cmd, timeout=15):
            captured["cmd"] = cmd
            return "", "", 0
        with unittest.mock.patch.object(rpw, "run", _fake_run):
            result = rpw.api_permissions_open({"pane": "fda"})
        self.assertEqual(result, {"ok": True, "pane": "fda"})
        self.assertIn(self.PANE_URLS["fda"], captured["cmd"])

    def test_unknown_pane_returns_400(self):
        with unittest.mock.patch.object(rpw, "run", self._run_ok):
            result = rpw.api_permissions_open({"pane": "unknown"})
        # Should return a (dict, 400) tuple
        self.assertIsInstance(result, tuple)
        data, status = result
        self.assertEqual(status, 400)
        self.assertFalse(data["ok"])

    def test_empty_pane_returns_400(self):
        with unittest.mock.patch.object(rpw, "run", self._run_ok):
            result = rpw.api_permissions_open({})
        self.assertIsInstance(result, tuple)
        data, status = result
        self.assertEqual(status, 400)
        self.assertFalse(data["ok"])

    def test_open_failure_returns_500(self):
        with unittest.mock.patch.object(rpw, "run", self._run_fail):
            result = rpw.api_permissions_open({"pane": "ax"})
        self.assertIsInstance(result, tuple)
        data, status = result
        self.assertEqual(status, 500)
        self.assertFalse(data["ok"])


# ── 8) Role-gating: client mode (BRIDGE) ─────────────────────────────────────

class TestClientRoleGating(unittest.TestCase):
    """role=client → ACCESS ONLY: no AX/SR, no permission prompts, regrant no-op."""

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._tmp = pathlib.Path(self._tmpdir.name)
        self._status = self._tmp / "logs" / "status.json"
        self._client_env = self._tmp / "client.env"
        self._role = self._tmp / "role"

    def tearDown(self):
        self._tmpdir.cleanup()

    def _patch(self):
        return unittest.mock.patch.multiple(
            rpw,
            STATUS_FILE=self._status,
            CLIENT_ENV=self._client_env,
            ROLE_FILE=self._role,
        )

    # 8a) client role → api_regrant needed:False (even with a live -host app + ax/sr)
    def test_client_regrant_needed_false(self):
        self._role.write_text("client\n")
        # Write a status that would otherwise trigger needed=True (ax False),
        # to prove the client gate short-circuits before any bundle/grant logic.
        _write_status(
            self._status,
            bundle_id="com.x10lab.remote-pair-host",
            ax=False,
            sr=False,
            fda=False,
            ts=_fresh_ts(),
        )
        with self._patch():
            result = rpw.api_regrant()
        self.assertFalse(result["needed"])
        self.assertTrue(result.get("client"))

    # 8b) client role → api_permissions_open is a no-op (run() must NOT be called)
    def test_client_permissions_open_noop(self):
        self._role.write_text("client\n")
        called = {"run": False}

        def _fake_run(cmd, timeout=15):
            called["run"] = True
            return "", "", 0

        with self._patch(), unittest.mock.patch.object(rpw, "run", _fake_run):
            result = rpw.api_permissions_open({"pane": "ax"})
        self.assertFalse(result["ok"])
        self.assertTrue(result.get("client"))
        self.assertIn("client", result.get("msg", ""))
        self.assertFalse(called["run"], "client mode must not shell out to `open`")

    # 8c) host role (explicit) → regrant uses normal logic (not gated)
    def test_host_role_regrant_not_gated(self):
        self._role.write_text("host\n")
        _write_status(
            self._status,
            bundle_id="com.x10lab.remote-pair-host",
            ax=False,
            sr=True,
            fda=True,
            ts=_fresh_ts(),
        )
        with self._patch():
            result = rpw.api_regrant()
        self.assertTrue(result["needed"])  # ax False on live host → regrant needed

    # 8d) empty/missing role defaults to host → not gated, permissions_open proceeds
    def test_empty_role_defaults_host_permissions_open(self):
        # Do NOT write the role file → empty → host default.
        captured = {}

        def _fake_run(cmd, timeout=15):
            captured["cmd"] = cmd
            return "", "", 0

        with self._patch(), unittest.mock.patch.object(rpw, "run", _fake_run):
            result = rpw.api_permissions_open({"pane": "sr"})
        self.assertTrue(result["ok"])
        self.assertEqual(result.get("pane"), "sr")
        self.assertIn("Privacy_ScreenCapture", captured["cmd"])

    # 8e) both role → not gated (host/both unchanged)
    def test_both_role_not_gated(self):
        self._role.write_text("both\n")
        with self._patch():
            self.assertTrue(rpw.is_host())
            self.assertFalse(rpw.is_client())


# ── 9) Handshake shape (BRIDGE) ──────────────────────────────────────────────

class TestHandshake(unittest.TestCase):
    """api_handshake() shape — monkeypatch ssh_run + resolve_host."""

    def _patch_host(self):
        return unittest.mock.patch.object(rpw, "resolve_host", lambda: "myhost")

    def test_no_host_returns_full_shape(self):
        with unittest.mock.patch.object(rpw, "resolve_host", lambda: ""):
            result = rpw.api_handshake()
        for key in ("ok", "ssh", "statusFresh", "statusAge", "ax", "sr", "tmuxUp"):
            self.assertIn(key, result)
        self.assertFalse(result["ok"])
        self.assertFalse(result["ssh"])
        self.assertIn("error", result)

    def test_ssh_unreachable_short_circuits(self):
        def _fake_ssh(cmd, timeout=15):
            return "", "Connection refused", 255
        with self._patch_host(), unittest.mock.patch.object(rpw, "ssh_run", _fake_ssh):
            result = rpw.api_handshake()
        self.assertFalse(result["ssh"])
        self.assertFalse(result["ok"])
        self.assertIn("error", result)

    def test_all_green_ok_true(self):
        fresh_status = json.dumps({"ts": _fresh_ts(), "ax": True, "sr": True})

        def _fake_ssh(cmd, timeout=15):
            if cmd == "true":
                return "", "", 0
            if "status.json" in cmd:
                return fresh_status, "", 0
            if "has-session" in cmd:
                return "", "", 0
            return "", "", 0

        with self._patch_host(), unittest.mock.patch.object(rpw, "ssh_run", _fake_ssh):
            result = rpw.api_handshake()
        self.assertTrue(result["ssh"])
        self.assertTrue(result["statusFresh"])
        self.assertTrue(result["ax"])
        self.assertTrue(result["sr"])
        self.assertTrue(result["tmuxUp"])
        self.assertTrue(result["ok"])
        self.assertIsNotNone(result["statusAge"])
        self.assertLessEqual(result["statusAge"], rpw.STALE_SECS)

    def test_stale_status_not_fresh_ax_sr_false(self):
        stale_status = json.dumps({"ts": _stale_ts(), "ax": True, "sr": True})

        def _fake_ssh(cmd, timeout=15):
            if cmd == "true":
                return "", "", 0
            if "status.json" in cmd:
                return stale_status, "", 0
            if "has-session" in cmd:
                return "", "", 0
            return "", "", 0

        with self._patch_host(), unittest.mock.patch.object(rpw, "ssh_run", _fake_ssh):
            result = rpw.api_handshake()
        self.assertTrue(result["ssh"])
        self.assertFalse(result["statusFresh"])
        # stale → ax/sr not trusted, reported False
        self.assertFalse(result["ax"])
        self.assertFalse(result["sr"])
        self.assertFalse(result["ok"])  # not fresh → not ok

    def test_tmux_down_makes_ok_false(self):
        fresh_status = json.dumps({"ts": _fresh_ts(), "ax": True, "sr": True})

        def _fake_ssh(cmd, timeout=15):
            if cmd == "true":
                return "", "", 0
            if "status.json" in cmd:
                return fresh_status, "", 0
            if "has-session" in cmd:
                return "", "no server running", 1
            return "", "", 0

        with self._patch_host(), unittest.mock.patch.object(rpw, "ssh_run", _fake_ssh):
            result = rpw.api_handshake()
        self.assertTrue(result["ssh"])
        self.assertTrue(result["statusFresh"])
        self.assertFalse(result["tmuxUp"])
        self.assertFalse(result["ok"])


# ── 10) SSH-assist shape (BRIDGE) ────────────────────────────────────────────

class TestSshAssist(unittest.TestCase):
    """api_ssh_pubkey / keygen / copy-id shapes — patch HOME glob + subprocess."""

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._tmp = pathlib.Path(self._tmpdir.name)
        self._ssh = self._tmp / ".ssh"
        self._ssh.mkdir(parents=True)

    def tearDown(self):
        self._tmpdir.cleanup()

    def _patch_home(self):
        return unittest.mock.patch.object(rpw.Path, "home", classmethod(lambda cls: self._tmp))

    def test_pubkey_absent(self):
        with self._patch_home():
            result = rpw.api_ssh_pubkey()
        self.assertFalse(result["exists"])
        self.assertEqual(result["pubkey"], "")
        self.assertIn("keyPath", result)

    def test_pubkey_present(self):
        (self._ssh / "id_ed25519.pub").write_text("ssh-ed25519 AAAA test@host\n")
        with self._patch_home():
            result = rpw.api_ssh_pubkey()
        self.assertTrue(result["exists"])
        self.assertIn("ssh-ed25519", result["pubkey"])
        self.assertTrue(result["keyPath"].endswith("id_ed25519"))

    def test_keygen_noop_when_key_exists(self):
        (self._ssh / "id_ed25519.pub").write_text("ssh-ed25519 AAAA test@host\n")
        called = {"run": False}

        def _fake_run(*a, **k):
            called["run"] = True
            raise AssertionError("subprocess.run must not be called when key exists")

        with self._patch_home(), unittest.mock.patch.object(rpw.subprocess, "run", _fake_run):
            result = rpw.api_ssh_keygen()
        self.assertTrue(result["ok"])
        self.assertFalse(result["created"])
        self.assertFalse(called["run"])

    def test_keygen_uses_argv_list_no_shell(self):
        captured = {}

        class _Res:
            returncode = 0
            stdout = "generated"
            stderr = ""

        def _fake_run(argv, *a, **k):
            captured["argv"] = argv
            return _Res()

        with self._patch_home(), unittest.mock.patch.object(rpw.subprocess, "run", _fake_run):
            result = rpw.api_ssh_keygen()
        self.assertTrue(result["ok"])
        self.assertTrue(result["created"])
        # argv list (not a shell string) with ed25519 + empty passphrase
        self.assertIsInstance(captured["argv"], list)
        self.assertEqual(captured["argv"][0], "ssh-keygen")
        self.assertIn("-t", captured["argv"])
        self.assertIn("ed25519", captured["argv"])
        self.assertIn("-N", captured["argv"])

    def test_copy_id_no_host_400(self):
        with self._patch_home(), unittest.mock.patch.object(rpw, "resolve_host", lambda: ""):
            result = rpw.api_ssh_copy_id()
        self.assertIsInstance(result, tuple)
        data, status = result
        self.assertEqual(status, 400)
        self.assertFalse(data["ok"])

    def test_copy_id_argv_list(self):
        (self._ssh / "id_ed25519.pub").write_text("ssh-ed25519 AAAA test@host\n")
        captured = {}

        class _Res:
            returncode = 0
            stdout = "Number of key(s) added: 1"
            stderr = ""

        def _fake_run(argv, *a, **k):
            captured["argv"] = argv
            return _Res()

        with self._patch_home(), \
                unittest.mock.patch.object(rpw, "resolve_host", lambda: "myhost"), \
                unittest.mock.patch.object(rpw.subprocess, "run", _fake_run):
            result = rpw.api_ssh_copy_id()
        self.assertTrue(result["ok"])
        self.assertIsInstance(captured["argv"], list)
        self.assertEqual(captured["argv"][0], "ssh-copy-id")
        self.assertIn("-i", captured["argv"])
        self.assertEqual(captured["argv"][-1], "myhost")


if __name__ == "__main__":
    unittest.main()
