import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Key,
  Loader2,
  Terminal,
  Wifi,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { capture, EVENTS, PATHS, REASONS, type Reason, type ConnPath } from "@/lib/telemetry";

export type ConnState = "idle" | "checking" | "reachable" | "rekeyed" | "failed";

// Map a controlled-reason from the SSH probe outcome (NEVER the raw stderr string — that leaks
// hostnames/paths). We only have a boolean + opaque err here, so failures bucket to host_unreachable
// (the dominant cause for a BatchMode probe); the bridge re-coerces anything unknown to `unknown`.
function reasonFromProbe(): Reason {
  return REASONS.HOST_UNREACHABLE;
}

function isHostKeyMismatch(err: string, state?: string): boolean {
  return (
    state === "host_key_mismatch" ||
    /host key|known_hosts|REMOTE HOST IDENTIFICATION|offending .*key|key verification/i.test(err)
  );
}

type Props = {
  host: string;
  setHost: (s: string) => void;
  state: ConnState;
  setState: (s: ConnState) => void;
  cliBlocked?: boolean;
  autoCheck?: boolean;
  onBackToDiscovery?: () => void;
};

export function StepConnect({
  host,
  setHost,
  state,
  setState,
  cliBlocked = false,
  autoCheck = false,
  onBackToDiscovery,
}: Props) {
  const [tailscale, setTailscale] = useState<{
    installed: boolean;
    up: boolean;
  } | null>(null);
  const [pubkey, setPubkey] = useState("");
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");
  const [hostIdentityTrusted, setHostIdentityTrusted] = useState(false);
  const autoCheckStarted = useRef(false);
  // Telemetry inputs for ssh_config_completed: whether a fresh key was generated this run, and how
  // the user transferred the pubkey to the host (auto = clicked the copy button; manual_paste = not).
  const [keygenNew, setKeygenNew] = useState(false);
  const [copyIdUsed, setCopyIdUsed] = useState(false);

  // On mount: probe Tailscale, generate/read the SSH key, and prefill the host.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const ts = await window.remotepair.tailscaleStatus();
        if (active) setTailscale(ts);
      } catch {
        if (active) setTailscale({ installed: false, up: false });
      }
      try {
        const k = await window.remotepair.sshKeygen();
        if (active) {
          setPubkey(k.pubkey);
          setKeygenNew(!!k.keygenNew);
        }
      } catch {
        /* keygen failure surfaces as an empty pubkey block */
      }
      try {
        const cfg = await window.remotepair.getConfig();
        if (active && cfg.remoteHost && !host) setHost(cfg.remoteHost);
      } catch {
        /* no saved host yet */
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addCmd = pubkey
    ? `echo '${pubkey}' >> ~/.ssh/authorized_keys`
    : "";

  // Real connection path used today: `.ts.net` host name or an up tailnet → tailscale, else lan.
  // (Bonjour LAN discovery does not exist yet, so `lan` = "not a tailnet name", not discovered.)
  const connPath = (): ConnPath =>
    /\.ts\.net$/i.test(host.trim()) || (tailscale?.installed && tailscale?.up)
      ? PATHS.TAILSCALE
      : PATHS.LAN;

  const check = async () => {
    if (cliBlocked || state === "checking" || !host.trim()) return;

    setErr("");
    setState("checking");
    const startedAt = Date.now();
    const path = connPath();
    try {
      const r = await window.remotepair.sshReachable(host.trim());
      if (r.reachable) {
        await window.remotepair.setHost(host.trim());
        setState("reachable");
        // host_connected: SSH session established (connect_ms measured around the probe).
        capture(EVENTS.HOST_CONNECTED, { path, connect_ms: Date.now() - startedAt });
        // ssh_config_completed: keygen + reachable config done. copy_id_method reflects whether the
        // user used the auto copy-id button (auto) or transferred the key by hand (manual_paste).
        capture(EVENTS.SSH_CONFIG_COMPLETED, {
          keygen_new: keygenNew,
          copy_id_method: copyIdUsed ? "auto" : "manual_paste",
        });
      } else {
        setErr(r.err || "Host did not respond.");
        if (isHostKeyMismatch(r.err || "", r.state)) setHostIdentityTrusted(false);
        setState(isHostKeyMismatch(r.err || "", r.state) ? "rekeyed" : "failed");
        // host_connect_failed + ssh_config_failed: enum reason only (never the raw r.err string).
        const reason = reasonFromProbe();
        capture(EVENTS.HOST_CONNECT_FAILED, { path, reason });
        capture(EVENTS.SSH_CONFIG_FAILED, { reason });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
      if (isHostKeyMismatch(message)) setHostIdentityTrusted(false);
      setState(isHostKeyMismatch(message) ? "rekeyed" : "failed");
      capture(EVENTS.HOST_CONNECT_FAILED, { path, reason: REASONS.UNKNOWN });
      capture(EVENTS.SSH_CONFIG_FAILED, { reason: REASONS.UNKNOWN });
    }
  };

  useEffect(() => {
    if (!autoCheck || autoCheckStarted.current || state !== "idle" || !host.trim()) return;
    autoCheckStarted.current = true;
    void check();
    // check intentionally stays local to this component; the ref guarantees one auto-run per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheck, host, state]);

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Connect to your host
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Reach the host over your tailnet, then verify SSH access.
      </p>

      {/* Tailscale guidance */}
      <div className="mt-5 rounded-xl border border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <Wifi className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Tailscale</span>
          {tailscale && (
            <span
              className={
                "rounded-full px-1.5 py-0.5 text-[10px] font-medium " +
                (tailscale.installed && tailscale.up
                  ? "bg-primary/15 text-primary"
                  : "bg-amber-500/15 text-amber-600")
              }
            >
              {tailscale.installed && tailscale.up
                ? "Ready"
                : tailscale.installed
                ? "Not running"
                : "Not installed"}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {tailscale === null
            ? "Checking Tailscale…"
            : tailscale.installed && tailscale.up
            ? "Your tailnet is up. Use the host's tailnet name below."
            : tailscale.installed
            ? "Tailscale is installed but not running. Start it, then use the host's tailnet name."
            : "Install Tailscale for zero-config reachability, or use a reachable SSH host below."}
        </p>
      </div>

      {/* SSH key + add-to-host hint */}
      <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">SSH key</span>
        </div>
        {pubkey ? (
          <>
            <div className="mt-2 truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
              {pubkey}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Run this on the host to authorize this Mac:
            </p>
            <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
              <span className="min-w-0 flex-1 truncate">{addCmd}</span>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(addCmd);
                  setCopied(true);
                  setCopyIdUsed(true); // auto copy-id transfer (vs. manual_paste).
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Copy add-to-host command"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </>
        ) : (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Preparing an ed25519 key…
          </p>
        )}
      </div>

      {/* Host input + check */}
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Terminal className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={host}
              onChange={(e) => {
                setHost(e.target.value);
                if (state !== "idle") setState("idle");
                setErr("");
                setHostIdentityTrusted(false);
              }}
              placeholder="host tailnet name or user@host"
              className="pl-9 font-mono text-sm"
              disabled={state === "checking"}
            />
          </div>
          <Button
            size="sm"
            onClick={check}
            disabled={state === "checking" || !host.trim()}
          >
            {state === "checking" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Check connection"
            )}
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          We'll run an SSH BatchMode probe to verify reachability.
        </p>
      </div>

      {/* Result */}
      {state === "reachable" && (
        <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm font-medium text-foreground">
              Host reachable
            </span>
          </div>
          <p className="mt-2 pl-7 text-xs text-muted-foreground">
            Saved as your remote host. You can continue.
          </p>
        </div>
      )}

      {(state === "failed" || state === "rekeyed") && (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
              <X className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm font-medium text-foreground">
              {state === "rekeyed" ? "Host identity changed" : "Couldn't reach host"}
            </span>
          </div>
          <p className="mt-2 flex items-start gap-1.5 pl-7 text-xs text-muted-foreground">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="min-w-0 break-words font-mono">
              {state === "rekeyed"
                ? "SSH host key changed. Re-pair this host, or verify the Mac and update known_hosts before retrying."
                : err || "SSH probe failed."}
            </span>
          </p>
          {state === "rekeyed" && (
            <div className="mt-3 space-y-2 pl-7">
              <p className="text-xs text-muted-foreground">
                If this is your host, remove only the stale known_hosts entry after
                checking the Mac itself. If this name points at a different Mac,
                change the host or re-discover before continuing.
              </p>
              <label className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-background/80 p-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={hostIdentityTrusted}
                  onChange={(e) => setHostIdentityTrusted(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-primary"
                />
                <span>
                  I re-paired this host or verified its identity and updated known_hosts.
                </span>
              </label>
            </div>
          )}
          {state === "failed" && (
            <p className="mt-3 pl-7 text-xs text-muted-foreground">
              Use a reachable SSH host, start Tailscale, or go back to discovery
              to choose another Mac.
            </p>
          )}
          <div className="mt-3 pl-7">
            <Button
              size="sm"
              variant="outline"
              onClick={check}
              disabled={cliBlocked || (state === "rekeyed" && !hostIdentityTrusted)}
            >
              Retry
            </Button>
            {onBackToDiscovery && (
              <Button size="sm" variant="ghost" className="ml-2" onClick={onBackToDiscovery}>
                Back to discovery
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
