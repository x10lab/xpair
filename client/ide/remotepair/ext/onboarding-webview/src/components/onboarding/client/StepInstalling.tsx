import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Box, Check, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Peer } from "@/global";

export type InstallState = "idle" | "installing" | "done" | "failed";
type PasswordStep = "none" | "notice" | "password";

type Props = {
  // Fresh-install (setup) path supplies a Peer; the update path (manual/connect/reconnect) has no
  // setup Peer, so it passes host/hostName explicitly. One of {peer} or {host} must be present.
  peer?: Peer;
  // Update mode: the host app is already installed but below MIN_COMPATIBLE_HOST. Reuses this step's
  // installHost progress UI but with force:true (overwrite the existing app) + a tmux-kill warning.
  isUpdate?: boolean;
  // Explicit host/display name + version context for update mode (no Peer to derive them from).
  host?: string;
  hostName?: string;
  // Host login account (defaults to the local username in App). Forwarded to installHost so the
  // password bootstrap authenticates to the RIGHT account when the host login differs from the
  // local user — otherwise ssh tries the bare host as the local user and the password is denied.
  account?: string;
  currentVersion?: string;
  requiredVersion?: string;
  state: InstallState;
  setState: (s: InstallState) => void;
  // Install/update succeeded. Setup path → advances to Grant. Update path → re-checks the host app.
  onDone: () => void;
  // Install failed → user can return to the fingerprint-confirm setup step for recovery.
  onFail: () => void;
};

const PHASES = [
  "Verified SSH key auth",
  "Pushed XpairHost.app",
  "Registering launch agent",
  "Starting host",
];

/**
 * Remote install progress. Drives window.remotepair.installHost() over SSH key auth only. This step
 * is never a dead end: on success it auto-advances to Grant; on failure it stays on an explicit
 * recovery surface so the user can retry key auth or review the fingerprint.
 */
export function StepInstalling({
  peer,
  isUpdate = false,
  host: hostProp,
  hostName,
  account,
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
  const [passwordErr, setPasswordErr] = useState("");
  // Update mode passes host/hostName directly (no setup Peer); setup mode derives them from peer.
  const host = hostProp || peer?.target || peer?.addrs?.[0] || peer?.name || "";
  const name = hostName || peer?.name || host;
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
  // overrides it. In update mode we pass force:true so the CLI overwrites the already-installed (but
  // incompatible) host app and restarts the host.
  const runInstall = useCallback((password?: string) => {
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
      setPhase((p) => Math.min(PHASES.length - 2, p + 1));
    }, 1200);
    phaseTimer.current = adv;
    const clearAdv = () => {
      if (phaseTimer.current === adv) phaseTimer.current = null;
      window.clearInterval(adv);
    };
    const acct = (account || "").trim();
    // Only forward the account on the SETUP path (fresh bare host, where the password bootstrap needs
    // it). On the UPDATE/reconnect path the host is typically an ssh-config alias whose `User` may
    // differ; passing the (auto-defaulted, local-username) account as `cliuser@alias` would override
    // that configured User and break otherwise-working hosts, so let the alias's SSH config apply.
    const opts = {
      host,
      ...(!isUpdate && acct ? { user: acct } : {}),
      ...(isUpdate ? { force: true } : {}),
      ...(password !== undefined ? { password } : {}),
    };
    window.remotepair
      .installHost(opts)
      .then((r) => {
        clearAdv();
        if (!isCurrent()) return;
        if (r.ok) {
          setAccountPassword("");
          setPhase(PHASES.length);
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
          setErr(r.err || "Install failed.");
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
  }, [host, account, isUpdate, setState]);

  const submitPassword = useCallback(() => {
    if (!accountPassword) {
      setPasswordErr("Enter the host account password.");
      return;
    }
    runInstall(accountPassword);
  }, [accountPassword, runInstall]);

  // Fresh-install (setup) mode auto-starts on mount — there's nothing on the host to destroy. Update
  // mode does NOT: forcing the reinstall restarts XpairHost and kills any running tmux sessions on
  // the host, so the user must read the warning and click "Update host" first. Their click IS the
  // consent.
  const started = useRef(false);
  useEffect(() => {
    if (isUpdate) return;
    if (started.current) return;
    started.current = true;
    runInstall();
  }, [isUpdate, runInstall]);

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
          {isUpdate ? <RefreshCw className="h-5 w-5" /> : <Box className="h-5 w-5" />}
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {isUpdate ? "Updating the host" : "Setting up the host"}
        </h2>
        <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
          {isUpdate
            ? state === "failed"
              ? `Couldn't update XpairHost on ${name}.`
              : state === "done"
              ? `XpairHost is updated on ${name}.`
              : state === "idle"
              ? `XpairHost on ${name} needs an update.`
              : `Updating XpairHost on ${name} over SSH.`
            : state === "failed"
            ? `Couldn't finish setting up ${name}.`
            : state === "done"
            ? `XpairHost is installed on ${name}.`
            : `Installing XpairHost on ${name} over SSH.`}
        </p>
      </div>

      {/* Update mode: the host app is already installed but too old. Make the consequence explicit —
          forcing the reinstall restarts XpairHost and kills any running tmux sessions on the host.
          The user's click to start IS the consent to that. */}
      {isUpdate && state !== "done" && (
        <div className="mx-auto mt-4 max-w-sm rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 text-xs text-amber-700 dark:text-amber-400">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">
                XpairHost is already installed
                {currentVersion ? ` (version ${currentVersion})` : ""} but too old
                {requiredVersion
                  ? `; the minimum compatible host version is ${requiredVersion} or newer`
                  : ""}.
              </p>
              <p>
                Updating will restart XpairHost and{" "}
                <span className="font-semibold">terminate any running tmux sessions on the host.</span>
              </p>
              {state === "idle" && !showingPassword && (
                <button
                  type="button"
                  onClick={() => runInstall()}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-3 py-1.5 font-semibold text-amber-700 transition-colors hover:bg-amber-500/25 dark:text-amber-300"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Update host
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
                <Button type="button" size="sm" variant="outline" className="h-8" onClick={onFail}>
                  Review fingerprint
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {!showingPassword && (
        <div className="mx-auto mt-5 max-w-sm space-y-3">
        {PHASES.map((label, i) => {
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
              {err || (isUpdate ? "Update failed." : "Install failed.")}{" "}
              {isUpdate
                ? "The host app was not updated. Make sure the host is reachable and try again."
                : "Key auth did not complete. Make sure Remote Login is on, this host is reachable, and the fingerprint still matches."}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 pl-6">
            <button
              type="button"
              onClick={() => runInstall()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 font-semibold text-destructive transition-colors hover:bg-destructive/15"
            >
              {isUpdate ? "Retry update" : "Retry key auth"}
            </button>
            <button
              type="button"
              onClick={onFail}
              className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-3 py-1.5 font-semibold text-muted-foreground transition-colors hover:bg-muted"
            >
              {isUpdate ? "Back" : "Review fingerprint"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
