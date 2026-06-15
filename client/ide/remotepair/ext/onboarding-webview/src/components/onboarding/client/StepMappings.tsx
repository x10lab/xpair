import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  FolderTree,
  Loader2,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type Mapping = { clientPath: string; hostPath: string };

/** Parse the raw FOLDER_MAPS env value (`client::host;client2::host2`) into entries. */
function parseFolderMaps(raw: string): Mapping[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf("::");
      if (idx === -1) return { clientPath: entry, hostPath: "" };
      return {
        clientPath: entry.slice(0, idx),
        hostPath: entry.slice(idx + 2),
      };
    });
}

type Props = {
  mappings: Mapping[];
  setMappings: (m: Mapping[]) => void;
};

export function StepMappings({ mappings, setMappings }: Props) {
  const [clientPath, setClientPath] = useState("");
  const [hostPath, setHostPath] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  const [syncBackend, setSyncBackend] = useState("");
  const isMount = syncBackend === "mount";

  // Seed the list from saved config (real state, not presets).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const cfg = await window.remotepair.getConfig();
        if (active) setSyncBackend(cfg.syncBackend);
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

  const add = async () => {
    const h = hostPath.trim();
    const c = clientPath.trim();
    if (!h) return;
    if (!isMount && !c) return; // third-party-sync needs an explicit client path
    setErr("");
    setAdding(true);
    try {
      let clientForMap = c;
      if (isMount) {
        // mount backend: actually mount the host folder, then map mountpoint :: host (addRoot pattern).
        const mr = await window.remotepair.mount(h);
        if (!mr || (typeof mr.code === "number" && mr.code !== 0) || !mr.mountpoint) {
          setErr((mr && mr.err) || "Mount failed.");
          return;
        }
        clientForMap = mr.mountpoint;
      }
      const r = await window.remotepair.addMapping(clientForMap, h);
      if (r && typeof r.code === "number" && r.code !== 0) {
        setErr(r.err || "Failed to add mapping.");
        return;
      }
      // Re-read from config so the list reflects what was actually saved.
      try {
        const cfg = await window.remotepair.getConfig();
        const parsed = parseFolderMaps(cfg.folderMaps);
        setMappings(parsed.length ? parsed : [...mappings, { clientPath: clientForMap, hostPath: h }]);
      } catch {
        setMappings([...mappings, { clientPath: clientForMap, hostPath: h }]);
      }
      setClientPath("");
      setHostPath("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Folder mappings
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Map a folder on this Mac to its matching folder on the host.
      </p>

      <div className="mt-6 space-y-3">
        {mappings.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center">
            <FolderTree className="h-7 w-7 text-muted-foreground/60" />
            <p className="mt-3 text-sm text-muted-foreground">
              No mappings yet. Add your first below.
            </p>
          </div>
        ) : (
          mappings.map((m, i) => (
            <div
              key={`${m.clientPath}::${m.hostPath}::${i}`}
              className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-xs"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                {m.clientPath}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                {m.hostPath}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {!isMount && (
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Client path
              </label>
              <Input
                value={clientPath}
                onChange={(e) => setClientPath(e.target.value)}
                placeholder="/path/on/this/mac"
                className="mt-1 font-mono text-xs"
                disabled={adding}
              />
            </div>
          )}
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Host path
            </label>
            <Input
              value={hostPath}
              onChange={(e) => setHostPath(e.target.value)}
              placeholder="/path/on/the/host"
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
          <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="min-w-0 break-words font-mono">{err}</span>
          </p>
        )}
      </div>
    </div>
  );
}
