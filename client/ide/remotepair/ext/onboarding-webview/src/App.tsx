import { useState } from "react";
import { WizardShell } from "@/components/onboarding/WizardShell";
import { AnimatedStep } from "@/components/onboarding/AnimatedStep";
import { useWizard } from "@/components/onboarding/useWizard";
import { Button } from "@/components/ui/button";
import { StepWelcome } from "@/components/onboarding/client/StepWelcome";
import {
  StepMethod,
  type ConnectMethod,
  type MountBackend,
  type MethodState,
} from "@/components/onboarding/client/StepMethod";
import {
  StepConnect,
  type ConnState,
} from "@/components/onboarding/client/StepConnect";
import {
  StepMappings,
  type Mapping,
} from "@/components/onboarding/client/StepMappings";
import { StepDone } from "@/components/onboarding/client/StepDone";

const STEP_TITLES = [
  "Welcome",
  "File access",
  "Connect",
  "Folder mappings",
  "Done",
];

export default function App() {
  const w = useWizard(5);

  // Method (US-005)
  const [method, setMethod] = useState<ConnectMethod | null>(null);
  const [mountBackend, setMountBackend] = useState<MountBackend>("smb");
  const [methodState, setMethodState] = useState<MethodState>("idle");

  // Connect (US-004)
  const [host, setHost] = useState("");
  const [connState, setConnState] = useState<ConnState>("idle");

  // Mappings (US-006)
  const [mappings, setMappings] = useState<Mapping[]>([]);

  // Hard gates: each step's Next is blocked until its real verification passes.
  const methodReady = methodState === "ready";
  const connectReady = connState === "reachable";
  const mappingsReady = mappings.length >= 1;

  const nextDisabled =
    (w.index === 1 && !methodReady) ||
    (w.index === 2 && !connectReady) ||
    (w.index === 3 && !mappingsReady);

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
        w.index === 0 ? "Get started" : w.index === 3 ? "Finish" : "Next"
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
        {w.index === 1 && (
          <StepMethod
            method={method}
            setMethod={setMethod}
            mountBackend={mountBackend}
            setMountBackend={setMountBackend}
            state={methodState}
            setState={setMethodState}
          />
        )}
        {w.index === 2 && (
          <StepConnect
            host={host}
            setHost={setHost}
            state={connState}
            setState={setConnState}
          />
        )}
        {w.index === 3 && (
          <StepMappings mappings={mappings} setMappings={setMappings} />
        )}
        {w.index === 4 && <StepDone host={host} mappings={mappings} />}
      </AnimatedStep>
    </WizardShell>
  );
}
