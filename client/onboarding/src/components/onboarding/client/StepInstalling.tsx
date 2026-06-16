import { useEffect, useRef, useState } from "react";
import { AlertCircle, Box, Check, Loader2, ShieldAlert } from "lucide-react";
import type { Peer } from "@/global";

export type InstallState = "idle" | "installing" | "done" | "failed";

type Props = {
  peer: Peer;
  user: string;
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
 * Remote install progress + permission handoff. Drives window.remotepair.installHost(); the
 * account password is collected by the askpass helper, never here. macOS won't let us grant TCC
 * remotely → we surface the handoff card and the GUI-session warning.
 */
export function StepInstalling({ peer, user, state, setState }: Props) {
  const [phase, setPhase] = useState(0);
  const [err, setErr] = useState("");
  const started = useRef(false);

  // Kick off the install once on mount.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setState("installing");
    let alive = true;

    // Cosmetic phase advance while the (single, blocking) CLI call runs; the real result below
    // overrides it. Progress lines come from the CLI's redacted output stream.
    const adv = setInterval(() => {
      setPhase((p) => Math.min(PHASES.length - 2, p + 1));
    }, 1200);

    void window.remotepair
      .installHost({ host: peer.addrs[0] || peer.name, user })
      .then((r) => {
        if (!alive) return;
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
        if (!alive) return;
        clearInterval(adv);
        setErr(String(e && e.message ? e.message : e));
        setState("failed");
      });

    return () => {
      alive = false;
      clearInterval(adv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="flex flex-col items-center text-center">
        <div className="mb-3 flex h-13 w-13 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Box className="h-5 w-5" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Setting up the host
        </h2>
        <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
          Installing RemotePairHost on {peer.name} over SSH.
        </p>
      </div>

      <div className="mx-auto mt-5 max-w-sm space-y-3">
        {PHASES.map((label, i) => {
          const done = i < phase;
          const now = i === phase && state === "installing";
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
              <span className={done || now ? "text-foreground" : "text-muted-foreground"}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {state === "failed" && (
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{err || "Install failed."} Nothing was left half-installed — re-run setup.</span>
        </div>
      )}

      {/* Permission handoff — macOS won't let us grant TCC remotely. */}
      <div className="mt-5 rounded-xl border border-border bg-muted/30 p-3.5">
        <div className="flex items-start gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-ts/15 text-accent-ts">
            <ShieldAlert className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-foreground">One thing only you can do</div>
            <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              macOS won't let us grant permissions remotely. On{" "}
              <span className="font-semibold text-foreground">{peer.name}</span>, turn on
              Accessibility, Screen Recording &amp; Full Disk Access — its own setup window will
              pop up.
            </div>
          </div>
        </div>
        <div className="mt-2.5 pl-9 text-[11.5px] leading-relaxed text-muted-foreground">
          ⚠︎ That Mac must be{" "}
          <span className="font-semibold text-foreground">
            logged in as {user || "your account"} on its screen
          </span>{" "}
          for input &amp; screen share to work.
        </div>
      </div>
    </div>
  );
}
