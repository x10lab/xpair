import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Box, Check, Loader2, RotateCw, ShieldAlert } from "lucide-react";
import type { Peer } from "@/global";

export type InstallState = "idle" | "installing" | "done" | "failed";

type HostPerms = { alive: boolean; ax: boolean; sr: boolean; fda: boolean };

type Props = {
  peer: Peer;
  user: string;
  // Account password the user typed on the previous step. Empty ⇒ the host already trusts the SSH
  // key, so the install authenticates by key. Cleared (setPassword("")) once the install succeeds.
  password: string;
  setPassword: (p: string) => void;
  state: InstallState;
  setState: (s: InstallState) => void;
};

const PHASES = [
  "Authorized SSH key",
  "Pushed RemotePairHost.app",
  "Registering launch agent",
  "Starting host",
];

/**
 * Remote install progress + permission handoff. Drives window.remotepair.installHost() with the
 * password the user entered IN the onboarding (handed to the CLI over a pipe — never argv/log). On
 * failure the step is never a dead-end: it offers Retry (re-uses the entered password) and the
 * wizard's Previous (re-enter it). After the app is up, it LIVE-polls the host's TCC grant status
 * (window.remotepair.hostPermissions) because macOS forbids granting Accessibility / Screen
 * Recording / Full Disk Access remotely — the user must toggle them on the host's own screen.
 */
export function StepInstalling({ peer, user, password, setPassword, state, setState }: Props) {
  const [phase, setPhase] = useState(0);
  const [err, setErr] = useState("");
  const [perms, setPerms] = useState<HostPerms | null>(null);
  const host = peer.target || peer.addrs[0] || peer.name;

  // Run (or re-run) the install. Cosmetic phase advance while the single blocking CLI call runs;
  // the real result overrides it. The secret is dropped the moment the install SUCCEEDS; on failure
  // it is kept so Retry can reuse it (a transient SSH/network failure shouldn't force re-typing).
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

  // Kick off once on mount.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runInstall();
  }, [runInstall]);

  // Once the app is up, poll the host's grant status so the handoff card reflects reality (✓ vs
  // waiting) as the user toggles permissions on the host's screen.
  useEffect(() => {
    if (state !== "done") return;
    let alive = true;
    const poll = () =>
      window.remotepair
        .hostPermissions({ host })
        .then((p) => {
          if (alive) setPerms(p);
        })
        .catch(() => {});
    poll();
    const t = setInterval(poll, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [state, host]);

  const installing = state === "installing";
  const allGranted = !!perms && perms.ax && perms.sr; // AX + SR are the run-gate; FDA is optional

  return (
    <div>
      <div className="flex flex-col items-center text-center">
        <div className="mb-3 flex h-13 w-13 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Box className="h-5 w-5" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Setting up the host</h2>
        <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
          {installing
            ? `Installing RemotePairHost on ${peer.name} over SSH.`
            : state === "done"
            ? `RemotePairHost is installed on ${peer.name}.`
            : `Couldn't finish setting up ${peer.name}.`}
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
        <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5">
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {err || "Install failed."} Nothing was left half-installed. Retry, or go Back to re-enter
              the account password.
            </span>
          </div>
          <button
            type="button"
            onClick={runInstall}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/15"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      )}

      {/* Permission handoff — macOS won't let us grant TCC remotely; LIVE status once the app is up. */}
      {state === "done" && (
        <div className="mt-5 rounded-xl border border-border bg-muted/30 p-3.5">
          <div className="flex items-start gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-ts/15 text-accent-ts">
              <ShieldAlert className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">
                {allGranted ? "Permissions granted" : "One thing only you can do"}
              </div>
              <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                {allGranted
                  ? `${peer.name} is ready — Accessibility & Screen Recording are on.`
                  : "macOS won't let us grant these remotely. On the host's own screen, turn them on — its setup window pops up automatically."}
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-1.5 pl-9">
            <PermRow label="Accessibility" granted={perms?.ax} pending={!perms} />
            <PermRow label="Screen Recording" granted={perms?.sr} pending={!perms} />
            <PermRow label="Full Disk Access" granted={perms?.fda} pending={!perms} optional />
          </div>

          <div className="mt-2.5 pl-9 text-[11.5px] leading-relaxed text-muted-foreground">
            ⚠︎ That Mac must be{" "}
            <span className="font-semibold text-foreground">
              logged in as {user || "your account"} on its screen
            </span>{" "}
            for screen share to work.
          </div>
        </div>
      )}
    </div>
  );
}

/** One TCC permission row with a live ✓ / waiting indicator. `granted` undefined ⇒ status pending. */
function PermRow({
  label,
  granted,
  pending,
  optional,
}: {
  label: string;
  granted: boolean | undefined;
  pending?: boolean;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span
        className={
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full " +
          (granted ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")
        }
      >
        {pending ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ) : granted ? (
          <Check className="h-2.5 w-2.5" />
        ) : (
          <span className="h-1 w-1 rounded-full bg-current" />
        )}
      </span>
      <span className={granted ? "text-foreground" : "text-muted-foreground"}>
        {label}
        {optional && <span className="ml-1 text-[10px] text-muted-foreground/70">(optional)</span>}
      </span>
      <span className="ml-auto text-[10.5px] text-muted-foreground">
        {pending ? "checking…" : granted ? "granted" : "waiting"}
      </span>
    </div>
  );
}
