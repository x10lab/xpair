import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import type { Peer } from "@/global";
import { FingerprintPanel } from "./StepConnectPin";

type Props = {
  peer: Peer;
  user: string;
  setUser: (u: string) => void;
};

/**
 * Set-up path: the host is SSH-able but RemotePair is not installed. The user confirms which
 * account to install as. SECURITY (Principle 2): there is intentionally NO password field in this
 * React tree — the one-time account password is collected only by the separate askpass helper
 * process the CLI spawns (SSH_ASKPASS, detached TTY). The renderer never sees the secret.
 */
export function StepSetupPassword({ peer, user, setUser }: Props) {
  const [fp, setFp] = useState<string | null>(peer.fp ?? null);

  useEffect(() => {
    if (fp) return;
    let alive = true;
    void window.remotepair
      .hostKeyFingerprint(peer.addrs[0] || peer.name)
      .then((r) => {
        if (alive && r.fp) setFp(r.fp);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fp, peer]);

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Sign in to install RemotePair
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {peer.name} doesn't have RemotePair yet. Sign in once so we can set it up — after this it's
        key-based, no more passwords.
      </p>

      <div className="mt-5">
        <label className="mb-1.5 block text-[11px] text-muted-foreground">Connect as</label>
        <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-muted/30">
          <Input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="ghyeong"
            className="rounded-none border-0 bg-transparent font-mono text-sm shadow-none focus-visible:ring-0"
          />
          <span className="flex items-center whitespace-nowrap border-l border-border bg-muted/40 px-3 text-sm text-muted-foreground">
            @ {peer.name}
          </span>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Defaults to your username. Change it for a different account on that Mac.
        </p>
      </div>

      <FingerprintPanel host={peer.name} fp={fp} firstTime />

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        When you continue, a separate macOS prompt will ask for the account password — RemotePair
        itself never sees or stores it.
      </p>
    </div>
  );
}
