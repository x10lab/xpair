import { useEffect, useState } from "react";
import { Check, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Peer } from "@/global";

type HostPerms = { alive: boolean; ax: boolean; sr: boolean; fda: boolean };

type Props = {
  peer: Peer;
  user: string;
  // Lifted to the wizard so Next stays gated until Accessibility + Screen Recording are granted.
  onReady: (ready: boolean) => void;
};

/**
 * Independent permission-grant step (setup path, right after the host app is installed). macOS
 * forbids granting Accessibility / Screen Recording / Full Disk Access remotely, so the user must
 * toggle them on the host's OWN screen — the host app pops its setup window automatically. This step
 * LIVE-polls the host's status.json (window.remotepair.hostPermissions) and gates Next until AX + SR
 * are on. FDA is recommended, not required.
 */
export function StepGrantPermissions({ peer, user, onReady }: Props) {
  const [perms, setPerms] = useState<HostPerms | null>(null);
  const host = peer.target || peer.addrs[0] || peer.name;

  useEffect(() => {
    let alive = true;
    const poll = () =>
      window.remotepair
        .hostPermissions({ host })
        .then((p) => {
          if (alive) setPerms(p);
        })
        .catch(() => {});
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [host]);

  // AX + SR are the run-gate (FDA is optional). Report readiness up so the wizard can enable Next.
  const granted = !!perms && perms.ax && perms.sr;
  useEffect(() => {
    onReady(granted);
  }, [granted, onReady]);

  return (
    <div>
      <div className="flex flex-col items-center text-center">
        <div
          className={
            "mb-3 flex h-13 w-13 items-center justify-center rounded-full " +
            (granted ? "bg-primary/10 text-primary" : "bg-accent-ts/15 text-accent-ts")
          }
        >
          {granted ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {granted ? "Permissions granted" : "Grant permissions on the host"}
        </h2>
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          {granted
            ? `${peer.name} is ready. Continue to map your folders.`
            : `macOS won't let us grant these remotely. On ${peer.name}'s own screen, turn them on — its setup window pops up automatically. We'll detect it here.`}
        </p>
      </div>

      <div className="mx-auto mt-5 max-w-sm space-y-2 rounded-xl border border-border bg-muted/30 p-3.5">
        <PermRow label="Accessibility" granted={perms?.ax} pending={!perms} />
        <PermRow label="Screen Recording" granted={perms?.sr} pending={!perms} />
        <PermRow label="Full Disk Access" granted={perms?.fda} pending={!perms} optional />
      </div>

      <p className="mx-auto mt-3 max-w-sm text-[11.5px] leading-relaxed text-muted-foreground">
        ⚠︎ That Mac must be{" "}
        <span className="font-semibold text-foreground">
          logged in as {user || "your account"} on its screen
        </span>{" "}
        for screen share to work.
      </p>
    </div>
  );
}

/** One TCC permission row with a live ✓ / waiting indicator. `granted` undefined ⇒ status pending. */
function PermRow({
  label,
  granted,
  pending,
  optional,
}: {
  label: string;
  granted: boolean | undefined;
  pending?: boolean;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span
        className={
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full " +
          (granted ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")
        }
      >
        {pending ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ) : granted ? (
          <Check className="h-2.5 w-2.5" />
        ) : (
          <span className="h-1 w-1 rounded-full bg-current" />
        )}
      </span>
      <span className={granted ? "text-foreground" : "text-muted-foreground"}>
        {label}
        {optional && <span className="ml-1 text-[10px] text-muted-foreground/70">(optional)</span>}
      </span>
      <span className="ml-auto text-[10.5px] text-muted-foreground">
        {pending ? "checking…" : granted ? "granted" : "waiting"}
      </span>
    </div>
  );
}
