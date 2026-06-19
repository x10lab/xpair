import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  FolderSymlink,
  FolderTree,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ConnectMethod = "mount" | "third-party-sync";
export type MountBackend = "smb" | "sshfs";
export type Mapping = {
  clientPath: string;
  hostPath: string;
  method: ConnectMethod;
};

// Convention: if a clientPath contains "/.xpair/host/mounts/" it was created by
// the mount backend (default_mountpoint places volumes there). FOLDER_MAPS does
// not store the method, so this is a best-effort inference. Explicit per-mapping
// persistence + re-mount-on-launch is a separate follow-up.
function inferMethod(clientPath: string): ConnectMethod {
  return clientPath.includes("/.xpair/host/mounts/") ? "mount" : "third-party-sync";
}

/** Parse the raw FOLDER_MAPS env value (`client::host;client2::host2`) into entries. */
export function parseFolderMaps(raw: string): Mapping[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf("::");
      const clientPath = idx === -1 ? entry : entry.slice(0, idx);
      const hostPath = idx === -1 ? "" : entry.slice(idx + 2);
      return { clientPath, hostPath, method: inferMethod(clientPath) };
    });
}

type Props = {
  mappings: Mapping[];
  setMappings: (m: Mapping[]) => void;
};

export function StepFileAccess({ mappings, setMappings }: Props) {
  // Per-form (per-mapping) method state — not global.
  const [formMethod, setFormMethod] = useState<ConnectMethod>("mount");
  const [mountBackend, setMountBackend] = useState<MountBackend>("smb");

  const [hostPath, setHostPath] = useState("");
  const [clientPath, setClientPath] = useState("");
  const [clientEdited, setClientEdited] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");

  const isMount = formMethod === "mount";

  // Seed the mapping list from saved config (real state, the source of truth).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cfg = await window.remotepair.getConfig();
        const parsed = parseFolderMaps(cfg.folderMaps);
        if (active && parsed.length) setMappings(parsed);
      } catch {
        /* no saved mappings yet */
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickMethod = (m: ConnectMethod) => {
    setFormMethod(m);
    setErr("");
    // Reset client-path prefill state when switching methods.
    setClientPath("");
    setClientEdited(false);
  };

  // Mount: derive the default mountpoint for the typed host path on blur,
  // unless the user has manually edited the client field (don't clobber their choice).
  const prefillMountpoint = async () => {
    if (!isMount || clientEdited) return;
    const h = hostPath.trim();
    if (!h) return;
    try {
      const mp = await window.remotepair.defaultMountpoint(h);
      if (mp && !clientEdited) setClientPath(mp);
    } catch {
      /* leave the field as-is on failure */
    }
  };

  const add = async () => {
    const h = hostPath.trim();
    const c = clientPath.trim();
    if (!h) return;
    if (!isMount && !c) return; // third-party-sync requires an explicit client path
    setErr("");
    setAdding(true);
    try {
      // 1. Validate the host path exists over SSH before recording anything.
      const v = await window.remotepair.hostPathExists(h);
      if (!v.exists) {
        setErr(v.err || "Host folder not found over SSH.");
        return;
      }

      // 2. Record the backend signal. For mount, pass the smb/sshfs choice.
      //    For sync, signal "third-party-sync" unless a mount mapping already exists
      //    (in which case the backend stays "mount" as the global signal).
      if (isMount) {
        await window.remotepair.setBackend("mount", mountBackend);
      } else {
        const hasMountMapping = mappings.some((m) => m.method === "mount");
        await window.remotepair.setBackend(
          hasMountMapping ? "mount" : "third-party-sync",
          hasMountMapping ? undefined : undefined,
        );
      }

      // 3. For mount, actually mount the host folder; use the real mountpoint.
      let effectiveClient = c;
      if (isMount) {
        const mr = await window.remotepair.mount(h, c || undefined);
        if (!mr || mr.code !== 0 || !mr.mountpoint) {
          setErr((mr && mr.err) || "Mount failed.");
          return;
        }
        effectiveClient = mr.mountpoint;
      }

      // 4. Record the mapping, then re-read config as the source of truth.
      await window.remotepair.addMapping(effectiveClient, h);
      try {
        const cfg = await window.remotepair.getConfig();
        const parsed = parseFolderMaps(cfg.folderMaps);
        setMappings(
          parsed.length
            ? parsed
            : [
                ...mappings,
                { clientPath: effectiveClient, hostPath: h, method: formMethod },
              ],
        );
      } catch {
        setMappings([
          ...mappings,
          { clientPath: effectiveClient, hostPath: h, method: formMethod },
        ]);
      }
      setHostPath("");
      setClientPath("");
      setClientEdited(false);
    } catch (e) {
      setErr(String(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        File access &amp; mapping
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Add folders one at a time — each can use a different access method.
      </p>

      {/* Existing mappings list — only when there ARE mappings. With none, the big empty-state box
          just wasted space above the form, so we skip it and let the add form lead (you're adding
          your first). The list (and its header) appears once the first mapping lands. */}
      {mappings.length > 0 && (
        <div className="mt-6 space-y-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Mapped folders
          </div>
          {mappings.map((m, i) => (
            <div
              key={`${m.clientPath}::${m.hostPath}::${i}`}
              className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-xs"
            >
              {/* Method badge */}
              <span
                className={
                  "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                  (m.method === "mount"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground")
                }
              >
                {m.method === "mount" ? "Mount" : "Sync"}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                {m.clientPath}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                {m.hostPath}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Add form: method toggle + inputs, no folder picker */}
      <div className="mt-6 rounded-xl border border-border bg-muted/30 p-3">
        {mappings.length === 0 && (
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <FolderTree className="h-4 w-4 text-muted-foreground/70" />
            Add your first folder mapping.
          </div>
        )}
        {/* Method toggle sits above the path inputs */}
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <MethodCard
            active={isMount}
            onClick={() => pickMethod("mount")}
            icon={<HardDrive className="h-4 w-4" />}
            title="Mount"
            desc="Appears in Finder as a volume."
          />
          <MethodCard
            active={formMethod === "third-party-sync"}
            onClick={() => pickMethod("third-party-sync")}
            icon={<FolderSymlink className="h-4 w-4" />}
            title="Third-party sync"
            desc="Map paths for Syncthing, Drive, etc."
          />
        </div>

        {/* smb / sshfs backend sub-toggle — only visible when Mount is selected */}
        {isMount && (
          <div className="mb-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Mount backend
            </div>
            <div className="mt-1.5 inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
              {(["smb", "sshfs"] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setMountBackend(b)}
                  disabled={adding}
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

        {/* Path inputs */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Host path
            </label>
            <Input
              value={hostPath}
              onChange={(e) => setHostPath(e.target.value)}
              onBlur={prefillMountpoint}
              placeholder="/path/on/the/host"
              className="mt-1 font-mono text-xs"
              disabled={adding}
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {isMount ? "Mount location" : "Client path"}
            </label>
            <Input
              value={clientPath}
              onChange={(e) => {
                setClientPath(e.target.value);
                setClientEdited(true);
              }}
              placeholder={
                isMount ? "appears as a Finder volume" : "/path/on/this/mac"
              }
              className="mt-1 font-mono text-xs"
              disabled={adding}
            />
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={add}
          disabled={adding || !hostPath.trim() || (!isMount && !clientPath.trim())}
          className="mt-3 w-full"
        >
          {adding ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-1.5 h-4 w-4" />
          )}
          Add mapping
        </Button>

        {err && (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="min-w-0 break-words font-mono">{err}</span>
            </p>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={add} disabled={adding}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          </div>
        )}
      </div>
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
        "flex items-start gap-2 rounded-xl border p-3 text-left transition-all " +
        (active
          ? "border-primary bg-primary/5"
          : "border-border hover:border-foreground/20 hover:bg-muted/30")
      }
    >
      <div
        className={
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg " +
          (active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
        }
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-foreground">{title}</span>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{desc}</p>
      </div>
    </button>
  );
}
