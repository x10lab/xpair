import { useEffect, useState } from "react";
import { WizardShell } from "@/components/onboarding/WizardShell";
import { AnimatedStep } from "@/components/onboarding/AnimatedStep";
import { useWizard } from "@/components/onboarding/useWizard";
import { Button } from "@/components/ui/button";
import { StepWelcome } from "@/components/onboarding/client/StepWelcome";
import {
  StepConnect,
  type ConnState,
} from "@/components/onboarding/client/StepConnect";
import {
  StepFileAccess,
  type Mapping,
} from "@/components/onboarding/client/StepFileAccess";
import { StepDone } from "@/components/onboarding/client/StepDone";
import { capture, EVENTS } from "@/lib/telemetry";

const STEP_TITLES = ["Welcome", "Connect", "File access & mapping", "Done"];

export default function App() {
  const w = useWizard(4);

  // onboarding_started — fired once when the onboarding webview mounts (consent-gated no-op
  // otherwise). StrictMode double-invokes effects in dev, but the production build mounts once.
  useEffect(() => {
    capture(EVENTS.ONBOARDING_STARTED);
  }, []);

  // Connect (US-004)
  const [host, setHost] = useState("");
  const [connState, setConnState] = useState<ConnState>("idle");

  // File access & mapping (US-003): per-folder mappings; method is chosen per-mapping in the form.
  const [mappings, setMappings] = useState<Mapping[]>([]);

  // Hard gates: each step's Next is blocked until its real verification passes.
  const connectReady = connState === "reachable";
  const mappingsReady = mappings.length >= 1;

  const nextDisabled =
    (w.index === 1 && !connectReady) || (w.index === 2 && !mappingsReady);

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
        w.index === 0 ? "Get started" : w.index === 2 ? "Finish" : "Next"
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
          <StepConnect
            host={host}
            setHost={setHost}
            state={connState}
            setState={setConnState}
          />
        )}
        {w.index === 2 && (
          <StepFileAccess
            mappings={mappings}
            setMappings={setMappings}
          />
        )}
        {w.index === 3 && <StepDone host={host} mappings={mappings} />}
      </AnimatedStep>
    </WizardShell>
  );
}
