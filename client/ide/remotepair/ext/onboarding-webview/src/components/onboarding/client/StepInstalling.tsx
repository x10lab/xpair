import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Box, Check, Loader2 } from "lucide-react";
import type { Peer } from "@/global";

export type InstallState = "idle" | "installing" | "done" | "failed";

type Props = {
  peer: Peer;
  state: InstallState;
  setState: (s: InstallState) => void;
  // Install succeeded (host app is up) → wizard advances to the independent Grant step.
  onDone: () => void;
  // Install failed → user can return to the fingerprint-confirm setup step for recovery.
  onFail: () => void;
};

const PHASES = [
  "Authorized SSH key",
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
  state,
  setState,
  onDone,
  onFail,
}: Props) {
  const [phase, setPhase] = useState(0);
  const [err, setErr] = useState("");
  const host = peer.target || peer.addrs[0] || peer.name;

  // Run the install. Cosmetic phase advance while the single blocking CLI call runs; the real result
  // overrides it.
  const runInstall = useCallback(() => {
    setErr("");
    setPhase(0);
    setState("installing");
    const adv = setInterval(() => {
      setPhase((p) => Math.min(PHASES.length - 2, p + 1));
    }, 1200);
    window.remotepair
      .installHost({ host })
      .then((r) => {
        clearInterval(adv);
        if (r.ok) {
          setPhase(PHASES.length);
          setState("done");
        } else {
          setErr(r.err || "Install failed.");
          setState("failed");
        }
      })
      .catch((e) => {
        clearInterval(adv);
        setErr(String(e && e.message ? e.message : e));
        setState("failed");
      });
  }, [host, setState]);

  // Kick off once on mount (also re-runs when the user returns to this step and proceeds again).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runInstall();
  }, [runInstall]);

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
          <Box className="h-5 w-5" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Setting up the host</h2>
        <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
          {state === "failed"
            ? `Couldn't finish setting up ${peer.name}.`
            : state === "done"
            ? `XpairHost is installed on ${peer.name}.`
            : `Installing XpairHost on ${peer.name} over SSH.`}
        </p>
      </div>

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
              {err || "Install failed."} Key auth did not complete. Make sure Remote Login is on,
              this host is reachable, and the fingerprint still matches.
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 pl-6">
            <button
              type="button"
              onClick={runInstall}
              className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 font-semibold text-destructive transition-colors hover:bg-destructive/15"
            >
              Retry key auth
            </button>
            <button
              type="button"
              onClick={onFail}
              className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-3 py-1.5 font-semibold text-muted-foreground transition-colors hover:bg-muted"
            >
              Review fingerprint
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
