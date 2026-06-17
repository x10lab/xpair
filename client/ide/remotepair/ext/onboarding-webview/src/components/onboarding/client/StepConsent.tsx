import { ConsentControls } from "./ConsentControls";

// Standalone consent page (2nd step) — decided BEFORE the activation funnel fires. Both toggles
// default OFF; re-toggleable on StepDone and in settings. The card itself omits its eyebrow
// (showHeader=false) since this step supplies the heading.
export function StepConsent() {
  return (
    <div className="flex flex-col items-center text-center">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Before you start
      </h2>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        Off by default. Anonymous only — never your files, paths, repo names, or IP. Change anytime
        in settings.
      </p>
      <div className="mt-6">
        <ConsentControls variant="prompt" showHeader={false} />
      </div>
    </div>
  );
}
