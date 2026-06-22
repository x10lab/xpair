import { useEffect, useState } from "react";
import { Check, Laptop, Wifi } from "lucide-react";

export type ConnectedClient = { name: string; user: string; ageSec: number };

// Connect step: guide the user to bring up Xpair on their other Mac, then poll the host bridge
// for connected clients. Read-only — there is no disconnect/revoke, only live status.
export function StepWaiting({
  onClientsChange,
}: {
  onClientsChange?: (clients: ConnectedClient[]) => void;
} = {}) {
  const [dots, setDots] = useState(1);
  const [hostname, setHostname] = useState("…");
  const [clients, setClients] = useState<ConnectedClient[]>([]);

  useEffect(() => {
    window.xpair.getHostInfo().then((i) => setHostname(i.hostname)).catch(() => {});
  }, []);

  // Poll the connected-client list every 3s. connectedClients() never throws (host returns [] on error).
  useEffect(() => {
    let alive = true;
    const tick = () => {
      window.xpair
        .connectedClients()
        .then((list) => { if (alive) setClients(list); })
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Animate the "waiting…" dots only while nobody is connected.
  useEffect(() => {
    if (clients.length > 0) return;
    const t = setInterval(() => setDots((d) => (d % 3) + 1), 500);
    return () => clearInterval(t);
  }, [clients.length]);

  const connected = clients.length > 0;

  // Lift fresh client context up so the wizard can hold Next and the Done step can confirm pairing.
  useEffect(() => {
    onClientsChange?.(clients);
  }, [clients, onClientsChange]);

  return (
    <div className="flex flex-col items-center text-center">
      {connected ? (
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Check className="h-7 w-7" />
        </div>
      ) : (
        <div className="relative mb-6 h-20 w-20">
          <span className="radar-ring" />
          <span className="radar-ring" style={{ animationDelay: "0.7s" }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary soft-pulse">
              <Wifi className="h-5 w-5" />
            </div>
          </div>
        </div>
      )}

      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        {connected
          ? clients.length === 1
            ? "Client connected"
            : `${clients.length} clients connected`
          : `Waiting for a client${".".repeat(dots)}`}
      </h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        On your other Mac, open Xpair — once it can SSH in, it connects automatically.
      </p>

      <div className="mt-6 w-full max-w-xs rounded-xl border border-border bg-muted/30 px-4 py-3 text-left">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          This Mac
        </div>
        <div className="mt-1 font-mono text-sm text-foreground">{hostname}</div>
      </div>

      {connected && (
        <div className="mt-4 w-full max-w-xs space-y-2">
          {clients.map((c) => (
            <div
              key={`${c.name}-${c.user}`}
              className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-left"
            >
              <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-primary">
                <Laptop className="h-3 w-3" />
                Connected from
              </div>
              <div className="font-mono text-sm text-foreground">{c.name}</div>
              <div className="mt-0.5 font-mono text-xs text-muted-foreground">{c.user}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
