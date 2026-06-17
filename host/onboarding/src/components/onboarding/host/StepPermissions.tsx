import { useEffect, useRef } from "react";
import { Accessibility, Check, ExternalLink, HardDrive, Loader2, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";

// Host permissions: Accessibility (required — approve auto-click via cliclick/System Events),
// Screen Recording (required — screen-share + approve OCR), Full Disk Access (recommended).
export type PermKey = "ax" | "sr" | "fda";
export type PermState = Record<PermKey, "pending" | "opening" | "granted">;

const ROWS: Array<{
  key: PermKey;
  name: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    key: "ax",
    name: "Accessibility (required)",
    desc: "Lets the host auto-approve prompts (clicks/keys) for computer-use.",
    icon: Accessibility,
  },
  {
    key: "sr",
    name: "Screen Recording (required)",
    desc: "Captures screenshots so Claude can see the screen.",
    icon: Monitor,
  },
  {
    key: "fda",
    name: "Full Disk Access (recommended)",
    desc: "Allows reading project files across protected locations.",
    icon: HardDrive,
  },
];

type Props = {
  state: PermState;
  setState: (s: PermState) => void;
};

export function StepPermissions({ state, setState }: Props) {
  // Keep a ref to the latest state so the poll reads current values without
  // re-subscribing the interval on every state change.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Poll the host's status.json for real grant detection. When the host
  // reports a permission as granted we flip that row to "granted"; rows the
  // host has not yet granted are left in their current ("pending"/"opening")
  // local state so the in-flight "Open Settings" affordance is preserved.
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const s = await window.remotepair.getStatus();
        if (cancelled) return;
        const cur = stateRef.current;
        const next: PermState = {
          ax: s.ax ? "granted" : cur.ax,
          sr: s.sr ? "granted" : cur.sr,
          fda: s.fda ? "granted" : cur.fda,
        };
        if (next.ax !== cur.ax || next.sr !== cur.sr || next.fda !== cur.fda) {
          setState(next);
        }
      } catch {
        // status.json unreadable / host not running — leave state untouched.
      }
    };

    poll();
    const id = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [setState]);

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Grant permissions
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        macOS requires you to enable each toggle yourself. We'll open the right
        Settings pane for you.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        <div className="space-y-2">
          {ROWS.map((r) => (
            <PermRow
              key={r.key}
              row={r}
              status={state[r.key]}
              onOpen={() => {
                // Register the host in the TCC list (CGRequestScreenCaptureAccess)
                // AND open the relevant Settings pane.
                window.remotepair.requestPermission(r.key);
                window.remotepair.openPermissionPane(r.key);
                setState({ ...state, [r.key]: "opening" });
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PermRow({
  row,
  status,
  onOpen,
}: {
  row: (typeof ROWS)[number];
  status: PermState[PermKey];
  onOpen: () => void;
}) {
  const Icon = row.icon;
  const granted = status === "granted";
  return (
    <div
      className={
        "flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors " +
        (granted ? "border-primary/30 bg-primary/5" : "border-border")
      }
    >
      <div
        className={
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " +
          (granted ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
        }
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{row.name}</span>
          <StatusPill status={status} />
        </div>
        <p className="text-xs text-muted-foreground">{row.desc}</p>
      </div>
      {!granted && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={onOpen}
          disabled={status === "opening"}
        >
          {status === "opening" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Open Settings
            </>
          )}
        </Button>
      )}
      {granted && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Check className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: PermState[PermKey] }) {
  if (status === "granted")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
        <Check className="h-2.5 w-2.5" />
        Granted
      </span>
    );
  if (status === "opening")
    return (
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        Waiting…
      </span>
    );
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      Not granted
    </span>
  );
}
