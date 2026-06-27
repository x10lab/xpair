import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  AlertTriangle,
  Download,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  Server,
  Terminal,
  Wifi,
} from "lucide-react";
import type { Peer, PeerSource, PeerStatus } from "@/global";

type Props = {
  /** Called when the user picks a peer (drives the auto-branch to reconnect vs setup). */
  onSelect: (peer: Peer) => void;
  /** Called when the user chooses "Enter host manually" → falls back to StepConnect. */
  onManual: () => void;
  /** Blocks CLI-backed discovery/fallback actions until the bundled xpair CLI is ready. */
  cliBlocked?: boolean;
};

/** Dedup peers by host-key fingerprint (UI backstop; the CLI already dedups). Peers without a
 *  fingerprint (SSH-only, Xpair not installed) are keyed by name so they aren't collapsed. */
function dedup(peers: Peer[]): Peer[] {
  const byKey = new Map<string, Peer>();
  for (const p of peers) {
    const key = p.fp ? `fp:${p.fp}` : `name:${p.name}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, p);
      continue;
    }
    // Merge sources/addrs from a duplicate (same machine seen on a second transport).
    const sources = Array.from(new Set([...(prev.sources || []), ...(p.sources || [])]));
    const addrs = Array.from(new Set([...(prev.addrs || []), ...(p.addrs || [])]));
    byKey.set(key, { ...prev, sources, addrs });
  }
  return Array.from(byKey.values());
}

const STATUS_LABEL: Record<PeerStatus, string> = {
  reconnect: "Reconnect",
  connect: "Connect",
  setup: "Set up",
};

type DiscoverDiagnostics = {
  error: string | null;
  retrying: boolean;
  retry: () => void;
};

const DiscoverDiagnosticsContext = createContext<DiscoverDiagnostics>({
  error: null,
  retrying: false,
  retry: () => {},
});

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "Discovery failed.");
  return message.length > 180 ? `${message.slice(0, 177)}...` : message;
}

export function StepDiscover({ onSelect, onManual, cliBlocked = false }: Props) {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [scannedOnce, setScannedOnce] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const retryDiscover = useCallback(() => {
    setPeers([]);
    setDiscoverError(null);
    setScannedOnce(false);
    setRetryNonce((nonce) => nonce + 1);
  }, []);

  useEffect(() => {
    if (cliBlocked) {
      setPeers([]);
      setScannedOnce(false);
      setDiscoverError(null);
      setDiscovering(false);
      return;
    }

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Poll discover until the first result, then keep browsing so late peers appear.
    const tick = async () => {
      if (stopped) return;
      setDiscovering(true);
      try {
        const res = await window.remotepair.discover();
        if (stopped) return;
        const nextPeers = dedup(res.peers || []);
        setPeers(nextPeers);
        setDiscoverError(res.err && nextPeers.length === 0 ? errorMessage(res.err) : null);
      } catch (error) {
        if (stopped) return;
        setDiscoverError(errorMessage(error));
      }
      setScannedOnce(true);
      setDiscovering(false);
      // Keep polling (browsing) so peers that join later still surface.
      timer = setTimeout(tick, 3000);
    };
    void tick();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [retryNonce, cliBlocked]);

  if (cliBlocked) return <CliBlocked />;

  const content = (() => {
    // Scanning: no result yet.
    if (!scannedOnce) return <Scanning />;

    // Empty: scanned, nothing found → diagnosis FIRST, then fallbacks.
    if (peers.length === 0) return <EmptyDiagnose onManual={onManual} />;

    // Found: deduped peer list with per-peer status, still browsing.
    return <Found peers={peers} onSelect={onSelect} onManual={onManual} />;
  })();

  return (
    <DiscoverDiagnosticsContext.Provider
      value={{ error: discoverError, retrying: discovering, retry: retryDiscover }}
    >
      {content}
    </DiscoverDiagnosticsContext.Provider>
  );
}

/* ------------------------------ scanning ------------------------------ */

function Scanning() {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative mb-6 h-20 w-20">
        <span className="radar-ring" />
        <span className="radar-ring" style={{ animationDelay: "0.7s" }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Wifi className="h-5 w-5" />
          </div>
        </div>
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Looking for your host…
      </h2>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        Scanning this network for Macs running XpairHost.
      </p>
      <div className="mt-5 flex flex-col items-start gap-2 text-xs text-muted-foreground">
        <Scanline label="Bonjour · same Wi-Fi" />
        <Scanline label="Tailscale · your tailnet" />
      </div>
    </div>
  );
}

function Scanline({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
      {label}
    </div>
  );
}

function CliBlocked() {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative mb-6 h-20 w-20">
        <span className="radar-ring" />
        <span className="radar-ring" style={{ animationDelay: "0.7s" }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        </div>
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Preparing xpair CLI…
      </h2>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        Discovery and manual connection will unlock once the CLI is ready.
      </p>
    </div>
  );
}

/* ------------------------------ found ------------------------------ */

function Found({
  peers,
  onSelect,
  onManual,
}: {
  peers: Peer[];
  onSelect: (p: Peer) => void;
  onManual: () => void;
}) {
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Found your host
      </h2>
      <p className="mt-1.5 mb-4 text-sm text-muted-foreground">
        The same machine on Wi-Fi and Tailscale is shown once (matched by host key).
      </p>

      <div className="space-y-2.5">
        {peers.map((p) => (
          <PeerRow key={p.fp || p.name} peer={p} onSelect={onSelect} />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          still looking…
        </div>
        <button
          type="button"
          onClick={onManual}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Enter manually
        </button>
      </div>
    </div>
  );
}

function PeerRow({ peer, onSelect }: { peer: Peer; onSelect: (p: Peer) => void }) {
  const isKnown = peer.status === "reconnect";
  const notInstalled = peer.status === "setup";
  return (
    <button
      type="button"
      onClick={() => onSelect(peer)}
      className={
        "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors " +
        (isKnown
          ? "border-primary/35 bg-primary/5"
          : "border-border bg-card hover:border-foreground/20")
      }
    >
      <span
        className={
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " +
          (isKnown ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
        }
      >
        <Server className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="truncate">{peer.name}</span>
          {(peer.sources || []).map((s) => (
            <SourceBadge key={s} source={s} />
          ))}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[11.5px] text-muted-foreground">
          {(peer.addrs || []).join(" · ")}
        </span>
        {notInstalled && (
          <span className="mt-1 flex items-center gap-1.5 text-[10.5px] text-accent-ts">
            <Download className="h-3 w-3" />
            Xpair not installed — we'll set it up
          </span>
        )}
      </span>
      <span className="shrink-0 rounded-md bg-primary/15 px-2.5 py-1 text-[10px] font-semibold text-primary">
        {STATUS_LABEL[peer.status]}
      </span>
    </button>
  );
}

function SourceBadge({ source }: { source: PeerSource }) {
  const map: Record<PeerSource, { label: string; cls: string }> = {
    lan: { label: "LAN", cls: "bg-accent-lan/20 text-accent-lan" },
    tailscale: { label: "TS", cls: "bg-accent-ts/20 text-accent-ts" },
    ssh: { label: "SSH", cls: "bg-muted text-muted-foreground" },
  };
  const b = map[source];
  return (
    <span className={"rounded-md px-1.5 py-0.5 text-[10px] font-semibold " + b.cls}>
      {b.label}
    </span>
  );
}

/* ------------------------------ empty / diagnose ------------------------------ */

function EmptyDiagnose({ onManual }: { onManual: () => void }) {
  const { error, retrying, retry } = useContext(DiscoverDiagnosticsContext);
  const hasError = !!error;

  return (
    <div>
      <div className="flex flex-col items-center text-center">
        <div
          className={
            "mb-3 flex h-14 w-14 items-center justify-center rounded-full " +
            (hasError ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")
          }
        >
          {hasError ? <AlertTriangle className="h-5 w-5" /> : <Search className="h-5 w-5" />}
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {hasError ? "Discovery couldn't finish" : "No other Mac here yet"}
        </h2>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          {hasError
            ? "We couldn't complete the last network scan."
            : "We couldn't see a host on this network."}
        </p>
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:border-foreground/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {retrying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {retrying ? "Scanning..." : "Retry scan"}
        </button>
      </div>

      {/* Diagnosis FIRST: client/network isolation is the most common cause. */}
      <div className="mt-5 rounded-xl border border-border bg-muted/30 p-3.5">
        <div className="flex items-start gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-ts/15 text-accent-ts">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-foreground">
              {hasError ? "Discovery scan failed" : "On the same Wi-Fi?"}
            </div>
            <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              {hasError
                ? error
                : "Public/office Wi-Fi often blocks devices from seeing each other. If so, use Tailscale below."}
            </div>
          </div>
        </div>
      </div>

      {/* Then fallbacks. */}
      <div className="mt-3 space-y-2">
        <FallbackRow
          icon={<Globe className="h-4 w-4" />}
          title="Connect over Internet (Uses Tailscale)"
          sub="Works anywhere · needs Tailscale on both Macs (~2 min)"
          onClick={onManual}
        />
        <FallbackRow
          icon={<Terminal className="h-4 w-4" />}
          title="Enter host manually"
          sub="Type an ssh host or IP yourself"
          onClick={onManual}
        />
      </div>
    </div>
  );
}

function FallbackRow({
  icon,
  title,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:border-foreground/20"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="block text-[11px] text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}
