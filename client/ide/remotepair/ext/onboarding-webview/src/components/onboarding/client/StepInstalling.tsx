import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Box, Check, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Peer } from "@/global";

export type InstallState = "idle" | "installing" | "done" | "failed";
type PasswordStep = "none" | "notice" | "password";

type Props = {
  // Fresh-install (setup) path supplies a Peer; the repair path (manual/connect/reconnect) has no
  // setup Peer, so it passes host/hostName explicitly. One of {peer} or {host} must be present.
  peer?: Peer;
  // Repair mode: force-installs missing/incompatible/update hosts, or restarts an installed
  // compatible-but-dead host through the non-force CLI path.
  isUpdate?: boolean;
  forceInstall?: boolean;
  repairKind?: "missing" | "update" | "restart" | "incompatible";
  // Explicit host/display name + version context for update mode (no Peer to derive them from).
  host?: string;
  hostName?: string;
  currentVersion?: string;
  requiredVersion?: string;
  state: InstallState;
  setState: (s: InstallState) => void;
  // Install/update succeeded. Setup path → advances to Grant. Update path → re-checks the host app.
  onDone: () => void;
  // Install failed → user can return to the fingerprint-confirm setup step for recovery.
  onFail: () => void;
};

const INSTALL_PHASES = [
  "Verified SSH key auth",
  "Pushed XpairHost.app",
  "Registering launch agent",
  "Starting host",
];

const RESTART_PHASES = [
  "Verified SSH key auth",
  "Found XpairHost.app",
  "Starting host",
  "Checking host",
];

/**
 * Remote install progress. Drives window.remotepair.installHost() over SSH key auth only. This step
 * is never a dead end: on success it auto-advances to Grant; on failure it stays on an explicit
 * recovery surface so the user can retry key auth or review the fingerprint.
 */
export function StepInstalling({
  peer,
  isUpdate = false,
  forceInstall = false,
  repairKind: repairKindProp,
  host: hostProp,
  hostName,
  currentVersion,
  requiredVersion,
  state,
  setState,
  onDone,
  onFail,
}: Props) {
  const [phase, setPhase] = useState(0);
  const [err, setErr] = useState("");
  const [passwordStep, setPasswordStep] = useState<PasswordStep>("none");
  const [accountPassword, setAccountPassword] = useState("");
  // Optional host login for the password bootstrap. Blank = same as the local Mac username (the
  // common case → no `user` forced, so an ssh-config alias's User still applies). Filled only when
  // the host login differs; passed as `user` ONLY on the password submit, never on auto/update.
  const [accountLogin, setAccountLogin] = useState("");
  const [passwordErr, setPasswordErr] = useState("");
  // Update mode passes host/hostName directly (no setup Peer); setup mode derives them from peer.
  const host = hostProp || peer?.target || peer?.addrs?.[0] || peer?.name || "";
  const name = hostName || peer?.name || host;
  const repairMode = isUpdate || forceInstall;
  const repairKind = repairKindProp || (isUpdate ? "update" : "incompatible");
  const useForce = repairMode && repairKind !== "restart";
  const phases = repairMode && !useForce ? RESTART_PHASES : INSTALL_PHASES;
  const repairTitle =
    repairKind === "missing"
      ? "Installing the host"
      : repairKind === "restart"
      ? "Restarting the host"
      : repairKind === "update"
      ? "Updating the host"
      : "Repairing the host";
  const repairIdle =
    repairKind === "missing"
      ? `XpairHost is missing on ${name}.`
      : repairKind === "restart"
      ? `XpairHost on ${name} is installed but not running.`
      : repairKind === "update"
      ? `XpairHost on ${name} needs an update.`
      : `XpairHost on ${name} is incompatible with this client.`;
  const repairButton =
    repairKind === "missing"
      ? "Install host"
      : repairKind === "restart"
      ? "Restart host"
      : repairKind === "update"
      ? "Update host"
      : "Repair host";
  const mounted = useRef(false);
  const installRunId = useRef(0);
  const phaseTimer = useRef<number | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      installRunId.current += 1;
      if (phaseTimer.current !== null) {
        window.clearInterval(phaseTimer.current);
        phaseTimer.current = null;
      }
    };
  }, []);

  // Run the install. Cosmetic phase advance while the single blocking CLI call runs; the real result
  // overrides it. Repair mode force-installs missing/incompatible/update hosts; restart repairs use
  // the non-force CLI path so an existing app is only kickstarted/opened. On a first-time host that
  // hasn't authorized this client's key, the CLI returns needs_password and we re-run with the
  // account password to bootstrap that one connection.
  const runInstall = useCallback((password?: string, accountArg?: string) => {
    const runId = ++installRunId.current;
    const isCurrent = () => mounted.current && installRunId.current === runId;
    if (phaseTimer.current !== null) {
      window.clearInterval(phaseTimer.current);
      phaseTimer.current = null;
    }
    setErr("");
    setPasswordErr("");
    setPasswordStep("none");
    setPhase(0);
    setState("installing");
    const adv = window.setInterval(() => {
      if (!isCurrent()) return;
      setPhase((p) => Math.min(phases.length - 2, p + 1));
    }, 1200);
    phaseTimer.current = adv;
    const clearAdv = () => {
      if (phaseTimer.current === adv) phaseTimer.current = null;
      window.clearInterval(adv);
    };
    // Do NOT force an account here. The only value available is the local macOS username
    // (App defaults `account` from hostInfo().user — there is no host-login input), so passing it as
    // `user` would either be redundant or, worse, override an ssh-config alias's configured `User`.
    // A host whose login differs is addressed by typing `user@host` (the bridge/CLI normalize that to
    // --account); the alias's SSH config `User` otherwise applies.
    const acct = (accountArg || "").trim();
    const opts = {
      host,
      ...(useForce ? { force: true } : {}),
      ...(password !== undefined ? { password } : {}),
      ...(acct ? { user: acct } : {}),
    };
    window.remotepair
      .installHost(opts)
      .then((r) => {
        clearAdv();
        if (!isCurrent()) return;
        if (r.ok) {
          setAccountPassword("");
          setPhase(phases.length);
          setState("done");
        } else if (r.state === "needs_password") {
          setAccountPassword("");
          setPasswordStep("notice");
          setState("idle");
        } else if (r.state === "password_denied") {
          setAccountPassword("");
          setPasswordErr(r.err || "The host account password was denied. Check it and try again.");
          setPasswordStep("password");
          setState("idle");
        } else {
          setErr(r.err || (repairMode ? "Repair failed." : "Install failed."));
          setState("failed");
        }
      })
      .catch((e) => {
        clearAdv();
        if (!isCurrent()) return;
        setAccountPassword("");
        setErr(String(e && e.message ? e.message : e));
        setState("failed");
      });
  }, [host, phases.length, repairMode, setState, useForce]);

  const submitPassword = useCallback(() => {
    if (!accountPassword) {
      setPasswordErr("Enter the host account password.");
      return;
    }
    runInstall(accountPassword, accountLogin);
  }, [accountPassword, accountLogin, runInstall]);

  // Fresh-install (setup) mode auto-starts on mount. Repair mode does NOT: the user clicks to start
  // the forced reinstall/update or the non-force restart.
  const started = useRef(false);
  useEffect(() => {
    if (repairMode) return;
    if (started.current) return;
    started.current = true;
    runInstall();
  }, [repairMode, runInstall]);

  // Success → advance to Grant. Failure stays here with explicit key-auth recovery actions.
  useEffect(() => {
    if (state === "done") {
      const t = setTimeout(onDone, 600);
      return () => clearTimeout(t);
    }
  }, [state, onDone]);

  const installing = state === "installing";
  const showingPassword = passwordStep !== "none" && state !== "installing" && state !== "done";

  return (
    <div>
      <div className="flex flex-col items-center text-center">
        <div className="mb-3 flex h-13 w-13 items-center justify-center rounded-full bg-primary/10 text-primary">
          {repairMode ? <RefreshCw className="h-5 w-5" /> : <Box className="h-5 w-5" />}
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {repairMode ? repairTitle : "Setting up the host"}
        </h2>
        <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
          {repairMode
            ? state === "failed"
              ? `Couldn't repair XpairHost on ${name}.`
              : state === "done"
              ? `XpairHost is ready on ${name}.`
              : state === "idle"
              ? repairIdle
              : repairKind === "restart"
              ? `Restarting XpairHost on ${name} over SSH.`
              : `Repairing XpairHost on ${name} over SSH.`
            : state === "failed"
            ? `Couldn't finish setting up ${name}.`
            : state === "done"
            ? `XpairHost is installed on ${name}.`
            : `Installing XpairHost on ${name} over SSH.`}
        </p>
      </div>

      {/* Repair mode: the user's click starts the repair/restart action. */}
      {repairMode && state !== "done" && (
        <div className="mx-auto mt-4 max-w-sm rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 text-xs text-amber-700 dark:text-amber-400">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">
                {repairKind === "missing"
                  ? `XpairHost is missing on ${name}.`
                  : repairKind === "restart"
                  ? `XpairHost is installed on ${name} but not running.`
                  : repairKind === "update"
                  ? `XpairHost is already installed${
                      currentVersion ? ` (version ${currentVersion})` : ""
                    } but too old${
                      requiredVersion
                        ? `; the minimum compatible host version is ${requiredVersion} or newer`
                        : ""
                    }.`
                  : `XpairHost is installed${
                      currentVersion ? ` (version ${currentVersion})` : ""
                    } but incompatible with this client.`}
              </p>
              {useForce ? (
                <p>
                  Repairing will reinstall and restart XpairHost and{" "}
                  <span className="font-semibold">terminate any running tmux sessions on the host.</span>
                </p>
              ) : (
                <p>This will ask the existing XpairHost app to start again without reinstalling it.</p>
              )}
              {state === "idle" && !showingPassword && (
                <button
                  type="button"
                  onClick={() => runInstall()}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-1.5 font-semibold text-amber-700 transition-colors hover:bg-amber-500/25 dark:text-amber-300"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {repairButton}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showingPassword && (
        <div className="mx-auto mt-5 max-w-sm rounded-xl border border-border bg-muted/25 p-4 text-left">
          {passwordStep === "notice" ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">Remote Login must be enabled on the host Mac.</p>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">
                    Check System Settings, General, Sharing, then turn on Remote Login for the account you use on this host.
                  </p>
                </div>
              </div>
              <Button type="button" size="sm" className="h-8" onClick={() => setPasswordStep("password")}>
                I Understand
              </Button>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                submitPassword();
              }}
            >
              <div className="min-w-0">
                <label htmlFor="xpair-account-login" className="text-sm font-semibold text-foreground">
                  Host login
                </label>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  Leave blank if it matches your Mac username; set it if your login on {name} differs.
                </p>
                <Input
                  id="xpair-account-login"
                  type="text"
                  value={accountLogin}
                  onChange={(e) => {
                    setAccountLogin(e.target.value);
                    setPasswordErr("");
                  }}
                  autoComplete="username"
                  spellCheck={false}
                  placeholder="(same as this Mac)"
                  className="mt-1.5 bg-background"
                />
              </div>
              <div className="flex items-start gap-2 text-sm">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <label htmlFor="xpair-account-password" className="font-semibold text-foreground">
                    Host account password
                  </label>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">
                    Used once to authorize this Mac's SSH key on {name}.
                  </p>
                </div>
              </div>
              <Input
                id="xpair-account-password"
                type="password"
                value={accountPassword}
                onChange={(e) => {
                  setAccountPassword(e.target.value);
                  setPasswordErr("");
                }}
                autoComplete="current-password"
                autoFocus
                className="bg-background"
              />
              {passwordErr && (
                <div className="flex items-start gap-2 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 break-words">{passwordErr}</span>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" className="h-8" disabled={!accountPassword}>
                  Continue
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => {
                    // Clear local password state first — the inline repair panel's onFail only sets
                    // installState back to "idle" (it doesn't unmount), so without this the form would
                    // stay visible (showingPassword still true) and the user would be stuck on it.
                    setPasswordStep("none");
                    setAccountPassword("");
                    setPasswordErr("");
                    onFail();
                  }}
                >
                  Review fingerprint
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {!showingPassword && (
        <div className="mx-auto mt-5 max-w-sm space-y-3">
        {phases.map((label, i) => {
          const done = i < phase;
          const now = i === phase && installing;
          return (
            <div key={label} className="flex items-center gap-3 text-sm">
              <span
                className={
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] " +
                  (done
                    ? "bg-primary/20 text-primary"
                    : now
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground")
                }
              >
                {done ? (
                  <Check className="h-3.5 w-3.5" />
                ) : now ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  i + 1
                )}
              </span>
              <span className={done || now ? "text-foreground" : "text-muted-foreground"}>{label}</span>
            </div>
          );
        })}
        </div>
      )}

      {state === "failed" && (
        <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-xs text-destructive">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">
              {err || (repairMode ? "Repair failed." : "Install failed.")}{" "}
              {repairMode
                ? "The host app was not repaired. Make sure the host is reachable and try again."
                : "Key auth did not complete. Make sure Remote Login is on, this host is reachable, and the fingerprint still matches."}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 pl-6">
            <button
              type="button"
              onClick={() => runInstall()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 font-semibold text-destructive transition-colors hover:bg-destructive/15"
            >
              {repairMode ? "Retry repair" : "Retry key auth"}
            </button>
            <button
              type="button"
              onClick={onFail}
              className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-3 py-1.5 font-semibold text-muted-foreground transition-colors hover:bg-muted"
            >
              {repairMode ? "Back" : "Review fingerprint"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
