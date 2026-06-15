import { useEffect, useState } from "react";
import { Check, Laptop, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ConnectedClient = { name: string; ip: string; user: string };

type Props = {
  connected: ConnectedClient | null;
  onSimulate: () => void;
};

export function StepWaiting({ connected, onSimulate }: Props) {
  const [dots, setDots] = useState(1);
  const [hostname, setHostname] = useState("…");

  useEffect(() => {
    window.remotepair.getHostInfo().then((i) => setHostname(i.hostname)).catch(() => {});
  }, []);

  useEffect(() => {
    if (connected) return;
    const t = setInterval(() => setDots((d) => (d % 3) + 1), 500);
    return () => clearInterval(t);
  }, [connected]);

  if (connected) {
    return (
      <div className="flex flex-col items-center text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Check className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Client connected
        </h2>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          You can keep this Mac running — sessions stay alive 24/7.
        </p>

        <div className="mt-6 w-full max-w-xs rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-left">
          <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-primary">
            <Laptop className="h-3 w-3" />
            Connected from
          </div>
          <div className="font-mono text-sm text-foreground">{connected.name}</div>
          <div className="mt-0.5 font-mono text-xs text-muted-foreground">
            {connected.user}@{connected.ip}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative mb-6 h-20 w-20">
        <span className="radar-ring" />
        <span className="radar-ring" style={{ animationDelay: "0.7s" }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary soft-pulse">
            <Wifi className="h-5 w-5" />
          </div>
        </div>
      </div>

      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Try a connection{".".repeat(dots)}
      </h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Optional: open RemotePair on your laptop and pick this Mac to confirm
        pairing works. You can skip and do it later.
      </p>

      <div className="mt-6 w-full max-w-xs rounded-xl border border-border bg-muted/30 px-4 py-3 text-left">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          This Mac
        </div>
        <div className="mt-1 font-mono text-sm text-foreground">
          {hostname}
        </div>
      </div>

      <Button
        size="sm"
        variant="ghost"
        className="mt-6 text-xs text-muted-foreground"
        onClick={onSimulate}
      >
        Simulate client connected
      </Button>
    </div>
  );
}
