import { Check } from "lucide-react";
import { ConsentControls } from "@/components/onboarding/host/ConsentControls";

export function StepDone({ paired = false }: { paired?: boolean }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Check className="h-7 w-7" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">
        {paired ? "You're paired" : "Host is ready"}
      </h2>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        {paired
          ? "RemotePairHost is running in your menu bar. Control sessions, view status, and stop the host from the menu bar icon."
          : "RemotePairHost is running in your menu bar. Pair a client anytime — open RemotePair on your laptop and pick this Mac. Manage everything from the menu bar icon."}
      </p>
      {/* Re-toggle summary — same opt-in flags, reflects whatever was chosen on Welcome. */}
      <div className="mt-6">
        <ConsentControls variant="summary" />
      </div>
    </div>
  );
}
