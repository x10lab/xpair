import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import type { Peer } from "@/global";
import { FingerprintPanel } from "./StepConnectPin";

type Props = {
  peer: Peer;
  user: string;
  setUser: (u: string) => void;
  password: string;
  setPassword: (p: string) => void;
};

/**
 * Set-up path: the host is SSH-able but RemotePair is not installed. The user confirms the account
 * and (if the host doesn't already trust the SSH key) types the account password RIGHT HERE — no
 * separate OS dialog. The password is handed to the CLI over a pipe (never argv/log/disk), used once
 * to install, then key-based forever. Leave it blank if the Mac already trusts your key.
 */
export function StepSetupPassword({ peer, user, setUser, password, setPassword }: Props) {
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

      <div className="mt-4">
        <label className="mb-1.5 block text-[11px] text-muted-foreground">Account password</label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="off"
          className="rounded-lg border-border bg-muted/30 font-mono text-sm"
        />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Used once to install, then never again. RemotePair sends it straight to the host — it's
          never stored. Leave blank if this Mac already trusts your SSH key.
        </p>
      </div>

      <FingerprintPanel host={peer.name} fp={fp} firstTime />
    </div>
  );
}
