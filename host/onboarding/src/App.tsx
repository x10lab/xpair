import { useCallback, useMemo, useState } from "react";
import { WizardShell } from "@/components/onboarding/WizardShell";
import { AnimatedStep } from "@/components/onboarding/AnimatedStep";
import { useWizard } from "@/components/onboarding/useWizard";
import { Button } from "@/components/ui/button";
import { StepWelcome } from "@/components/onboarding/host/StepWelcome";
import {
  StepPermissions,
  type PermState,
} from "@/components/onboarding/host/StepPermissions";
import { StepDone } from "@/components/onboarding/host/StepDone";

// The app self-launches this onboarding AFTER it is already installed, so there is no
// install step and no "waiting for client" step — just Welcome → Permissions → Done.
const STEP_TITLES = ["Welcome", "Permissions", "Done"];

export default function App() {
  // The host can deep-link this onboarding straight to the Permissions step (menu-bar
  // "Grant Permissions…"): OnboardingWindow injects window.__rp_initialStep before app code runs.
  const initialStep =
    typeof window !== "undefined" &&
    (window as unknown as { __rp_initialStep?: string }).__rp_initialStep === "permissions"
      ? 1
      : 0;
  const w = useWizard(3, initialStep);
  const [perm, setPerm] = useState<PermState>({
    ax: "pending",
    sr: "pending",
    fda: "pending",
  });

  // The Permissions "Next" gate requires Accessibility + Screen Recording (both required:
  // approve auto-click needs AX, screen-share/OCR needs SR). Full Disk Access is recommended.
  const ready = useMemo(
    () => perm.ax === "granted" && perm.sr === "granted",
    [perm.ax, perm.sr],
  );

  const nextDisabled = w.index === 1 && !ready;

  const handleNext = useCallback(() => {
    w.next();
  }, [w]);

  return (
    <WizardShell
      title="RemotePairHost"
      subtitle={STEP_TITLES[w.index]}
      step={w.index}
      totalSteps={w.totalSteps}
      onPrev={w.prev}
      onNext={w.isLast ? undefined : handleNext}
      nextDisabled={nextDisabled}
      nextLabel={w.index === 0 ? "Begin setup" : "Next"}
      footerSlot={
        w.isLast ? (
          <Button size="sm" onClick={() => window.remotepair.complete()}>
            Open RemotePair
          </Button>
        ) : null
      }
      centerSlot={null}
    >
      <AnimatedStep stepKey={w.index} direction={w.direction}>
        {w.index === 0 && <StepWelcome />}
        {w.index === 1 && <StepPermissions state={perm} setState={setPerm} />}
        {w.index === 2 && <StepDone />}
      </AnimatedStep>
    </WizardShell>
  );
}
