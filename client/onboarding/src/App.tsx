import { useState } from "react";
import { WizardShell } from "@/components/onboarding/WizardShell";
import { AnimatedStep } from "@/components/onboarding/AnimatedStep";
import { useWizard } from "@/components/onboarding/useWizard";
import { Button } from "@/components/ui/button";
import { StepWelcome } from "@/components/onboarding/client/StepWelcome";
import {
  StepMethod,
  type ConnectMethod,
} from "@/components/onboarding/client/StepMethod";
import {
  StepConnect,
  type ConnState,
} from "@/components/onboarding/client/StepConnect";
import { StepMappings, type Mapping } from "@/components/onboarding/client/StepMappings";
import { StepDone } from "@/components/onboarding/client/StepDone";

const STEP_TITLES = [
  "Welcome",
  "Connection method",
  "Connect",
  "Folder mappings",
  "Done",
];

export default function App() {
  const w = useWizard(5);
  const [method, setMethod] = useState<ConnectMethod | null>(null);
  const [alias, setAlias] = useState("");
  const [connState, setConnState] = useState<ConnState>("idle");
  const [mappings, setMappings] = useState<Mapping[]>([]);

  const readyToProceed =
    connState === "connected_installed" || connState === "install_done";

  const nextDisabled =
    (w.index === 1 && method !== "ssh") || (w.index === 2 && !readyToProceed);

  return (
    <WizardShell
      title="RemotePair"
      subtitle={STEP_TITLES[w.index]}
      step={w.index}
      totalSteps={w.totalSteps}
      onPrev={w.prev}
      onNext={w.isLast ? undefined : w.next}
      nextDisabled={nextDisabled}
      nextLabel={
        w.index === 0
          ? "Get started"
          : w.index === 3
          ? "Finish"
          : "Next"
      }
      footerSlot={
        w.isLast ? (
          <Button size="sm" onClick={() => window.remotepair.complete()}>
            Open RemotePair
          </Button>
        ) : null
      }
    >
      <AnimatedStep stepKey={w.index} direction={w.direction}>
        {w.index === 0 && <StepWelcome />}
        {w.index === 1 && <StepMethod value={method} onChange={setMethod} />}
        {w.index === 2 && (
          <StepConnect
            alias={alias}
            setAlias={setAlias}
            state={connState}
            setState={setConnState}
          />
        )}
        {w.index === 3 && (
          <StepMappings mappings={mappings} setMappings={setMappings} />
        )}
        {w.index === 4 && <StepDone hostAlias={alias} mappings={mappings} />}
      </AnimatedStep>
    </WizardShell>
  );
}
