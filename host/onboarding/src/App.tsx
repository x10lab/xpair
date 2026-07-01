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
import { StepWaiting, type ConnectedClient } from "@/components/onboarding/host/StepWaiting";
import { HostDoneClientContext, StepDone } from "@/components/onboarding/host/StepDone";
import { StepEngine } from "@/components/onboarding/host/StepEngine";
import type { EngineId } from "@/global";
import { useT } from "@/lib/i18n";

// The app self-launches this onboarding AFTER it is already installed, so there is no install step:
// Welcome(0) → Permissions(1) → Engine(2) → Connect(3) → Done(4). Engine follows the permission grant:
// the agent engine must be installed AND signed in on this host before pairing is useful.
const STEP_TITLES = ["Welcome", "Permissions", "Engine", "Connect", "Done"];

export default function App() {
  const { t } = useT();
  // The host can deep-link this onboarding to a specific step (menu-bar "Permissions…"/"Connect…"):
  // OnboardingWindow injects window.__rp_initialStep before app code runs. 'permissions'→1, 'connect'→2,
  // anything else (incl. unset, "Set up…")→0 (Welcome).
  const deepLink =
    typeof window !== "undefined"
      ? (window as unknown as { __rp_initialStep?: string }).__rp_initialStep
      : undefined;
  const initialStep =
    deepLink === "permissions" ? 1 : deepLink === "engine" ? 2 : deepLink === "connect" ? 3 : 0;
  const w = useWizard(5, initialStep);
  const [perm, setPerm] = useState<PermState>({
    ax: "pending",
    sr: "pending",
    fda: "pending",
  });
  const [engine, setEngine] = useState<EngineId>("claude");
  // HARD-GATE for the Engine step: the chosen engine must be installed AND signed in on this host.
  const [engineReady, setEngineReady] = useState(false);
  // Q0543: with no connected client, the Connect step must hold rather than report completion.
  const [connectedClients, setConnectedClients] = useState<ConnectedClient[]>([]);

  // The Permissions "Next" gate requires Accessibility + Screen Recording (both required:
  // approve auto-click needs AX, screen-share/OCR needs SR). Full Disk Access is recommended.
  const ready = useMemo(
    () => perm.ax === "granted" && perm.sr === "granted",
    [perm.ax, perm.sr],
  );

  const connected = connectedClients.length > 0;
  const pairedClient = connectedClients[0] ?? null;

  const nextDisabled =
    (w.index === 1 && !ready) || (w.index === 2 && !engineReady) || (w.index === 3 && !connected);

  const handleNext = useCallback(() => {
    w.next();
  }, [w]);

  return (
    <WizardShell
      title="XpairHost"
      subtitle={STEP_TITLES[w.index]}
      step={w.index}
      totalSteps={w.totalSteps}
      onPrev={w.prev}
      onNext={w.isLast ? undefined : handleNext}
      nextDisabled={nextDisabled}
      nextLabel={w.index === 0 ? t("shell.beginSetup") : t("shell.next")}
      footerSlot={
        w.isLast ? (
          <Button size="sm" onClick={() => window.xpair.complete()}>
            {t("shell.openXpair")}
          </Button>
        ) : null
      }
      centerSlot={null}
    >
      <HostDoneClientContext.Provider value={pairedClient}>
        <AnimatedStep stepKey={w.index} direction={w.direction}>
          {w.index === 0 && <StepWelcome />}
          {w.index === 1 && <StepPermissions state={perm} setState={setPerm} />}
          {w.index === 2 && (
            <StepEngine engine={engine} setEngine={setEngine} onReady={setEngineReady} />
          )}
          {w.index === 3 && <StepWaiting onClientsChange={setConnectedClients} />}
          {w.index === 4 && <StepDone />}
        </AnimatedStep>
      </HostDoneClientContext.Provider>
    </WizardShell>
  );
}
