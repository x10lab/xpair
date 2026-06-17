import { useEffect, useState } from "react";
import { AlertCircle, Check, Loader2, RotateCw, ShieldCheck } from "lucide-react";
import type { Peer } from "@/global";
import { FingerprintPanel } from "./StepConnectPin";

type ReconStatus = "checking" | "ready" | "offline";

type Props = {
  peer: Peer;
  // Lifted to the wizard so Next stays gated until the host is confirmed reachable.
  onReady: (ready: boolean) => void;
};

/**
 * Reconnect path: this client already has an ssh-config entry for the host (key auth was set up by a
 * prior install/pair) AND the app is installed — so there is NOTHING to pair. This step just
 * (re)persists REMOTE_HOST and confirms the host is reachable over the existing key, then lets the
 * user continue. No PIN, no password.
 */
export function StepReconnect({ peer, onReady }: Props) {
  const host = peer.target || peer.addrs[0] || peer.name;
  const [status, setStatus] = useState<ReconStatus>("checking");
  const [fp, setFp] = useState<string | null>(peer.fp ?? null);
  const [attempt, setAttempt] = useState(0);

  // Persist REMOTE_HOST + verify key-auth reachability on mount (and on each retry).
  useEffect(() => {
    let alive = true;
    setStatus("checking");
    onReady(false);
    (async () => {
      try {
        await window.remotepair.setHost(host);
      } catch {
        /* setHost failure shouldn't block the reachability check */
      }
      try {
        const r = await window.remotepair.sshReachable(host);
        if (!alive) return;
        setStatus(r.reachable ? "ready" : "offline");
        onReady(r.reachable);
      } catch {
        if (!alive) return;
        setStatus("offline");
        onReady(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [host, attempt, onReady]);

  // Fill the TOFU panel if discovery didn't advertise the fingerprint.
  useEffect(() => {
    if (fp) return;
    let alive = true;
    void window.remotepair
      .hostKeyFingerprint(host)
      .then((r) => {
        if (alive && r.fp) setFp(r.fp);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fp, host]);

  return (
    <div className="flex flex-col items-center text-center">
      <div
        className={
          "mb-5 flex h-14 w-14 items-center justify-center rounded-full " +
          (status === "offline" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")
        }
      >
        <ShieldCheck className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        {status === "offline" ? "Can't reach the host" : "Reconnect to your host"}
      </h2>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{peer.name}</span> is already set up.{" "}
        {status === "offline"
          ? "It's not answering over SSH right now — make sure it's awake and on the network."
          : "Reconnecting with your existing key — no PIN or password needed."}
      </p>

      <div className="mt-5 flex min-h-6 items-center gap-2 text-xs">
        {status === "checking" && (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Reconnecting to {peer.name}…
          </span>
        )}
        {status === "ready" && (
          <span className="flex items-center gap-2 text-primary">
            <Check className="h-3.5 w-3.5" />
            Reachable — your key works. Continue.
          </span>
        )}
        {status === "offline" && (
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-1.5 font-semibold text-destructive transition-colors hover:bg-destructive/15"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Retry
          </button>
        )}
      </div>

      {status === "offline" && (
        <div className="mt-3 flex items-start gap-2 text-[11.5px] text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>If it stays unreachable, the host may have moved networks — re-discover it.</span>
        </div>
      )}

      <FingerprintPanel host={peer.name} fp={fp} />
    </div>
  );
}
