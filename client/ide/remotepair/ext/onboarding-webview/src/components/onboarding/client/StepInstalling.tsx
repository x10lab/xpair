import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Box, Check, Loader2 } from "lucide-react";
import type { Peer } from "@/global";

export type InstallState = "idle" | "installing" | "done" | "failed";

type Props = {
  peer: Peer;
  user: string;
  // Account password the user typed on the previous step. Empty ⇒ the host already trusts the SSH
  // key, so the install authenticates by key. Cleared (setPassword("")) once the install succeeds.
  password: string;
  setPassword: (p: string) => void;
  state: InstallState;
  setState: (s: InstallState) => void;
  // Install succeeded (host app is up) → wizard advances to the independent Grant step.
  onDone: () => void;
  // Install failed → wizard returns to the setup/password step so the user can re-enter and retry.
  onFail: () => void;
};

const PHASES = [
  "Authorized SSH key",
  "Pushed XpairHost.app",
  "Registering launch agent",
  "Starting host",
];

/**
 * Remote install progress. Drives window.remotepair.installHost() with the password the user typed
 * IN the onboarding (handed to the CLI over a pipe — never argv/log). This step is never a dead-end:
 * on success it AUTO-ADVANCES to the Grant step; on failure it shows the error briefly then
 * AUTO-RETURNS to the setup step to re-enter the password (the install is idempotent, so a retry
 * after a transient SSH hiccup just re-registers).
 */
export function StepInstalling({
  peer,
  user,
  password,
  setPassword,
  state,
  setState,
  onDone,
  onFail,
}: Props) {
  const [phase, setPhase] = useState(0);
  const [err, setErr] = useState("");
  const host = peer.target || peer.addrs[0] || peer.name;

  // Run the install. Cosmetic phase advance while the single blocking CLI call runs; the real result
  // overrides it. The secret is dropped on SUCCESS; kept on failure so the re-entry step is pre-filled.
  const runInstall = useCallback(() => {
    setErr("");
    setPhase(0);
    setState("installing");
    const adv = setInterval(() => {
      setPhase((p) => Math.min(PHASES.length - 2, p + 1));
    }, 1200);
    window.remotepair
      .installHost({ host, user, password })
      .then((r) => {
        clearInterval(adv);
        if (r.ok) {
          setPassword(""); // consumed — drop the secret from renderer state
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
  }, [host, user, password, setPassword, setState]);

  // Kick off once on mount (also re-runs when the user returns to this step and proceeds again).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runInstall();
  }, [runInstall]);

  // Success → advance to Grant. Failure → show the error briefly, then return to re-enter password.
  useEffect(() => {
    if (state === "done") {
      const t = setTimeout(onDone, 600);
      return () => clearTimeout(t);
    }
    if (state === "failed") {
      const t = setTimeout(onFail, 2200);
      return () => clearTimeout(t);
    }
  }, [state, onDone, onFail]);

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
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {err || "Install failed."} Nothing was left half-installed — taking you back to re-enter
            the account password…
          </span>
        </div>
      )}
    </div>
  );
}
