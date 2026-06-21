import { useState } from "react";
import { Folder, FolderTree, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type MappingMode = "mount" | "sync";
export type Mapping = {
  id: string;
  mode: MappingMode;
  hostPath?: string;
  clientPath?: string;
};

const PRESET_HOST = ["~/Spaces/Work", "~/Google Drive", "~/Documents/Projects"];
const PRESET_CLIENT = ["/Mounts/Work", "/GDrive", "~/RemoteProjects"];

type Props = {
  mappings: Mapping[];
  setMappings: (m: Mapping[]) => void;
};

export function StepMappings({ mappings, setMappings }: Props) {
  const add = () =>
    setMappings([...mappings, { id: crypto.randomUUID(), mode: "mount" }]);
  const remove = (id: string) => setMappings(mappings.filter((m) => m.id !== id));
  const patch = (id: string, p: Partial<Mapping>) =>
    setMappings(mappings.map((m) => (m.id === id ? { ...m, ...p } : m)));

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Folder mappings
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Mount host folders on this Mac, or pair folders for two-way sync.
      </p>

      <div className="mt-6 space-y-3">
        {mappings.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center">
            <FolderTree className="h-7 w-7 text-muted-foreground/60" />
            <p className="mt-3 text-sm text-muted-foreground">
              No mappings yet. Add your first below.
            </p>
          </div>
        )}

        {mappings.map((m, i) => (
          <MappingRow
            key={m.id}
            index={i}
            mapping={m}
            onChange={(p) => patch(m.id, p)}
            onRemove={() => remove(m.id)}
          />
        ))}

        <Button variant="outline" size="sm" onClick={add} className="w-full">
          <Plus className="mr-1.5 h-4 w-4" />
          Add mapping
        </Button>
      </div>
    </div>
  );
}

function MappingRow({
  index,
  mapping,
  onChange,
  onRemove,
}: {
  index: number;
  mapping: Mapping;
  onChange: (p: Partial<Mapping>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Mapping {index + 1}
        </span>
        <button
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
          aria-label="Remove mapping"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-3 inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
        {(["mount", "sync"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => onChange({ mode })}
            className={
              "rounded-md px-3 py-1 text-xs font-medium transition-colors " +
              (mapping.mode === mode
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {mode === "mount" ? "Mount" : "Sync (P2P)"}
          </button>
        ))}
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        {mapping.mode === "mount"
          ? "Mount a host folder at a path on this Mac. Single source of truth."
          : "Two-way sync between host and client folders (Syncthing)."}
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <PathPicker
          label="Host folder"
          value={mapping.hostPath}
          presets={PRESET_HOST}
          onPick={(p) => onChange({ hostPath: p })}
        />
        <PathPicker
          label={mapping.mode === "mount" ? "Mount point" : "Client folder"}
          value={mapping.clientPath}
          presets={PRESET_CLIENT}
          onPick={(p) => onChange({ clientPath: p })}
        />
      </div>
    </div>
  );
}

function PathPicker({
  label,
  value,
  presets,
  onPick,
}: {
  label: string;
  value?: string;
  presets: string[];
  onPick: (p: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-xs transition-colors hover:border-foreground/20"
      >
        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono">
          {value ?? <span className="text-muted-foreground">Choose {label.toLowerCase()}…</span>}
        </span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-border bg-popover p-1 shadow-md">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {label} (simulated picker)
          </div>
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => {
                onPick(p);
                setOpen(false);
              }}
              className="block w-full rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-accent"
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
