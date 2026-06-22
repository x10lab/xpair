import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import type { Peer } from "@/global";
import { FingerprintPanel } from "./FingerprintPanel";

type Props = {
  peer: Peer;
  user: string;
  setUser: (u: string) => void;
};

/**
 * Set-up path: the host is SSH-able but Xpair is not installed. The user confirms the target
 * account and fingerprint; install proceeds over public-key SSH only. If the key agent/passphrase
 * is locked or the host does not trust this key yet, the bridge returns an explicit recovery state
 * and the user can approve/unlock/authorize the key before retrying.
 */
export function StepSetupPassword({ peer, user, setUser }: Props) {
  const [fp, setFp] = useState<string | null>(peer.fp ?? null);

  useEffect(() => {
    if (fp) return;
    let alive = true;
    void window.remotepair
      .hostKeyFingerprint(peer.target || peer.addrs[0] || peer.name)
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
        Confirm SSH access
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {peer.name} doesn't have Xpair yet. We'll install it over your SSH key after you confirm
        the host fingerprint.
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
    </div>
  );
}
