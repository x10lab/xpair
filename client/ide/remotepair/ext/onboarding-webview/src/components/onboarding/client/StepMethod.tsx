import { useState } from "react";
import {
  AlertCircle,
  Check,
  FolderSymlink,
  HardDrive,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type ConnectMethod = "mount" | "third-party-sync";
export type MountBackend = "smb" | "sshfs";
export type MethodState = "idle" | "working" | "ready" | "failed";

type Props = {
  method: ConnectMethod | null;
  setMethod: (m: ConnectMethod) => void;
  mountBackend: MountBackend;
  setMountBackend: (b: MountBackend) => void;
  state: MethodState;
  setState: (s: MethodState) => void;
};

export function StepMethod({
  method,
  setMethod,
  mountBackend,
  setMountBackend,
  state,
  setState,
}: Props) {
  const [err, setErr] = useState("");

  const setup = async () => {
    if (!method) return;
    setErr("");
    setState("working");
    try {
      if (method === "mount") {
        // Record the backend choice only; the actual per-folder mount happens in the Mappings step
        // (a folder to mount is only known there), mirroring extension.js addRoot (mount + map).
        await window.remotepair.setBackend("mount", mountBackend);
        setState("ready");
      } else {
        await window.remotepair.setBackend("third-party-sync");
        setState("ready");
      }
    } catch (e) {
      setErr(String(e));
      setState("failed");
    }
  };

  const pick = (m: ConnectMethod) => {
    setMethod(m);
    if (state !== "idle") setState("idle");
  };

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        How should files be accessed?
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Pick how the host's folders appear on this Mac.
      </p>

      <div className="mt-6 grid gap-3">
        <MethodCard
          active={method === "mount"}
          onClick={() => pick("mount")}
          icon={<HardDrive className="h-4 w-4" />}
          title="Mount"
          desc="Mount host folders so they appear in Finder. Single source of truth."
        />
        <MethodCard
          active={method === "third-party-sync"}
          onClick={() => pick("third-party-sync")}
          icon={<FolderSymlink className="h-4 w-4" />}
          title="Third-party sync"
          desc="Keep folders identical with an external tool (Syncthing, Drive, iCloud…). RemotePair only maps the paths."
        />
      </div>

      {method === "mount" && (
        <div className="mt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Mount backend
          </div>
          <div className="mt-2 inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
            {(["smb", "sshfs"] as const).map((b) => (
              <button
                key={b}
                onClick={() => {
                  setMountBackend(b);
                  if (state !== "idle") setState("idle");
                }}
                disabled={state === "working"}
                className={
                  "rounded-md px-3 py-1 text-xs font-medium uppercase transition-colors " +
                  (mountBackend === b
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      )}

      {method && (
        <div className="mt-5">
          <Button
            size="sm"
            className="w-full"
            onClick={setup}
            disabled={state === "working" || state === "ready"}
          >
            {state === "working" ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {method === "mount" ? "Mounting…" : "Recording choice…"}
              </>
            ) : state === "ready" ? (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                {method === "mount" ? "Mount backend set" : "Sync backend set"}
              </>
            ) : method === "mount" ? (
              "Mount now"
            ) : (
              "Use third-party sync"
            )}
          </Button>
        </div>
      )}

      {state === "ready" && (
        <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs text-muted-foreground">
          {method === "mount"
            ? "Mount backend selected — add host folders in the Mappings step (each is mounted on add, appearing in Finder)."
            : "Recorded. Your external sync tool keeps the folders identical; map the paths next."}
        </div>
      )}

      {state === "failed" && (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
              <X className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm font-medium text-foreground">
              Setup failed
            </span>
          </div>
          <p className="mt-2 flex items-start gap-1.5 pl-7 text-xs text-muted-foreground">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="min-w-0 break-words font-mono">
              {err || "Backend setup failed."}
            </span>
          </p>
          <div className="mt-3 pl-7">
            <Button size="sm" variant="outline" onClick={setup}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function MethodCard({
  active,
  onClick,
  icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex items-start gap-3 rounded-xl border p-4 text-left transition-all " +
        (active
          ? "border-primary bg-primary/5"
          : "border-border hover:border-foreground/20 hover:bg-muted/30")
      }
    >
      <div
        className={
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " +
          (active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
        }
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
    </button>
  );
}
