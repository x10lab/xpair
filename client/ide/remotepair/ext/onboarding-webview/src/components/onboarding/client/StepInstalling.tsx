import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Box, Check, Loader2, RefreshCw } from "lucide-react";
import type { Peer } from "@/global";

export type InstallState = "idle" | "installing" | "done" | "failed";

type Props = {
  // Fresh-install (setup) path supplies a Peer; the repair path (manual/connect/reconnect) has no
  // setup Peer, so it passes host/hostName explicitly. One of {peer} or {host} must be present.
  peer?: Peer;
  // Repair mode: force-installs the bundled host over a missing/incompatible/dead host app and
  // restarts it. The below-floor update case keeps the existing update wording via repairKind.
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
  // Update mode passes host/hostName directly (no setup Peer); setup mode derives them from peer.
  const host = hostProp || peer?.target || peer?.addrs?.[0] || peer?.name || "";
  const name = hostName || peer?.name || host;
  const repairMode = isUpdate || forceInstall;
  const repairKind = repairKindProp || (isUpdate ? "update" : "incompatible");
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
  // overrides it. In repair mode we pass force:true so the CLI overwrites/reinstalls the host app and
  // restarts it.
  const runInstall = useCallback(() => {
    const runId = ++installRunId.current;
    const isCurrent = () => mounted.current && installRunId.current === runId;
    if (phaseTimer.current !== null) {
      window.clearInterval(phaseTimer.current);
      phaseTimer.current = null;
    }
    setErr("");
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
    window.remotepair
      .installHost(repairMode ? { host, force: true } : { host })
      .then((r) => {
        clearAdv();
        if (!isCurrent()) return;
        if (r.ok) {
          setPhase(PHASES.length);
          setState("done");
        } else {
          setErr(r.err || (repairMode ? "Repair failed." : "Install failed."));
          setState("failed");
        }
      })
      .catch((e) => {
        clearAdv();
        if (!isCurrent()) return;
        setErr(String(e && e.message ? e.message : e));
        setState("failed");
      });
  }, [host, repairMode, setState]);

  // Fresh-install (setup) mode auto-starts on mount. Repair mode does NOT: forcing the reinstall
  // restarts XpairHost and kills any running tmux sessions on the host, so the user must read the
  // warning and click first. Their click IS the consent.
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
              : `Repairing XpairHost on ${name} over SSH.`
            : state === "failed"
            ? `Couldn't finish setting up ${name}.`
            : state === "done"
            ? `XpairHost is installed on ${name}.`
            : `Installing XpairHost on ${name} over SSH.`}
        </p>
      </div>

      {/* Repair mode: force-installing restarts XpairHost and can kill running host sessions.
          The user's click to start IS the consent to that. */}
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
              <p>
                Repairing will restart XpairHost and{" "}
                <span className="font-semibold">terminate any running tmux sessions on the host.</span>
              </p>
              {state === "idle" && (
                <button
                  type="button"
                  onClick={runInstall}
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
              onClick={runInstall}
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
