import { createContext, useContext } from "react";
import { Check } from "lucide-react";
import { ConsentControls } from "@/components/onboarding/host/ConsentControls";

type PairedClient = { name: string; user: string };

export const HostDoneClientContext = createContext<PairedClient | null>(null);

export function StepDone() {
  const pairedClient = useContext(HostDoneClientContext);

  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Check className="h-7 w-7" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">
        {pairedClient ? "You're paired" : "Host is ready"}
      </h2>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        {pairedClient
          ? `XpairHost is paired with ${pairedClient.name}. Control sessions, view status, and stop the host from the menu bar icon.`
          : "XpairHost is running in your menu bar. Pair a client anytime — open Xpair on your laptop and pick this Mac. Manage everything from the menu bar icon."}
      </p>
      {pairedClient && (
        <div className="mt-6 w-full max-w-xs rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-left">
          <div className="text-[10px] uppercase tracking-wide text-primary">Connected from</div>
          <div className="mt-1 font-mono text-sm text-foreground">{pairedClient.name}</div>
          <div className="mt-0.5 font-mono text-xs text-muted-foreground">{pairedClient.user}</div>
        </div>
      )}
      {/* Re-toggle summary — same opt-in flags, reflects whatever was chosen on Welcome. */}
      <div className="mt-6">
        <ConsentControls variant="summary" />
      </div>
    </div>
  );
}
