import { useEffect, useState } from "react";
import { AlertCircle, Check, KeyRound, Loader2 } from "lucide-react";
import type { Peer } from "@/global";
import { FingerprintPanel } from "./FingerprintPanel";

type Props = {
  peer: Peer;
  onReady: (ready: boolean) => void;
  onFingerprint?: (fp: string | null) => void;
  error?: string;
};

type KeyState = "preparing" | "ready" | "failed";

/**
 * Set-up path: the host is SSH-able but Xpair is not installed. The user confirms the host key
 * fingerprint, then Xpair uses the client's SSH key. No account password or pairing/6-digit code is
 * collected in this renderer step — install proceeds over public-key SSH only. If the key
 * agent/passphrase is locked or the host does not trust this key yet, the bridge returns an explicit
 * recovery state and the user can unlock/authorize the key before retrying.
 */
export function StepSetupPassword({ peer, onReady, onFingerprint, error = "" }: Props) {
  const host = peer.target || peer.addrs[0] || peer.name;
  const [fp, setFp] = useState<string | null>(peer.fp ?? null);
  const [fpErr, setFpErr] = useState("");
  const [pubkey, setPubkey] = useState("");
  const [keyState, setKeyState] = useState<KeyState>("preparing");
  const [keygenNew, setKeygenNew] = useState(false);

  useEffect(() => {
    setFp(peer.fp ?? null);
    setFpErr("");
  }, [host, peer.fp]);

  useEffect(() => {
    onFingerprint?.(fp);
  }, [fp, onFingerprint]);

  useEffect(() => {
    let alive = true;
    setKeyState("preparing");
    setPubkey("");
    setKeygenNew(false);
    void window.remotepair
      .sshKeygen()
      .then((r) => {
        if (!alive) return;
        setPubkey(r.pubkey || "");
        setKeygenNew(!!r.keygenNew);
        setKeyState(r.pubkey ? "ready" : "failed");
      })
      .catch(() => {
        if (alive) setKeyState("failed");
      });
    return () => {
      alive = false;
      onReady(false);
    };
  }, [onReady]);

  useEffect(() => {
    if (fp) return;
    let alive = true;
    void window.remotepair
      .hostKeyFingerprint(host)
      .then((r) => {
        if (!alive) return;
        if (r.fp) setFp(r.fp);
        else setFpErr(r.err || "Could not read this host's SSH fingerprint.");
      })
      .catch((e) => {
        if (alive) setFpErr(String(e));
      });
    return () => {
      alive = false;
    };
  }, [fp, host]);

  useEffect(() => {
    onReady(keyState === "ready" && !!fp);
  }, [keyState, fp, onReady]);

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Confirm this host
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Xpair will set up <span className="font-semibold text-foreground">{peer.name}</span> with
        your SSH key. No account password or 6-digit code is used.
      </p>

      <div className="mt-5 rounded-xl border border-border bg-muted/30 p-3.5">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Client SSH key</span>
          {keyState === "preparing" ? (
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Preparing
            </span>
          ) : keyState === "ready" ? (
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-primary">
              <Check className="h-3 w-3" />
              {keygenNew ? "Generated" : "Reused"}
            </span>
          ) : (
            <span className="ml-auto text-[11px] text-destructive">Failed</span>
          )}
        </div>

        {pubkey ? (
          <div className="mt-2 truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
            {pubkey}
          </div>
        ) : null}

        <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">SSH target</div>
          <div className="mt-0.5 truncate font-mono text-sm text-foreground">{host}</div>
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          During setup, Xpair authorizes this public key on the host and writes its managed SSH
          config for future key-auth connections.
        </p>
      </div>

      <FingerprintPanel host={peer.name} fp={fp} firstTime />

      {(keyState === "failed" || fpErr || error || !fp) && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700">
          {keyState === "preparing" && !fpErr && !error ? (
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span className="min-w-0">
            {keyState === "failed"
              ? "Could not prepare the client SSH key. If your key agent or passphrase is locked, unlock it; otherwise check ~/.ssh permissions, then retry onboarding."
              : fpErr
              ? fpErr
              : error
              ? error
              : "Fetching the host fingerprint. Continue after it is available and matches the host."}
          </span>
        </div>
      )}
    </div>
  );
}
