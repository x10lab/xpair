import { Check } from "lucide-react";
import type { Mapping } from "./StepFileAccess";

type Props = { host: string; mappings: Mapping[] };

export function StepDone({ host, mappings }: Props) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Check className="h-7 w-7" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">
        You're all set
      </h2>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        RemotePair is connected to{" "}
        <span className="font-mono text-foreground">{host}</span> with{" "}
        {mappings.length} mapping{mappings.length === 1 ? "" : "s"}.
      </p>

      <div className="mt-8 w-full max-w-sm rounded-xl border border-border bg-muted/30 p-4 text-left">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Summary
        </div>
        <div className="mt-2 flex justify-between text-sm">
          <span className="text-muted-foreground">Host</span>
          <span className="font-mono text-foreground">{host}</span>
        </div>
        <div className="mt-1.5 flex justify-between text-sm">
          <span className="text-muted-foreground">Mappings</span>
          <span className="text-foreground">{mappings.length}</span>
        </div>
      </div>
    </div>
  );
}
