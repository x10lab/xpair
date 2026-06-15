import { useCallback, useEffect, useMemo, useState } from "react";
import { WizardShell } from "@/components/onboarding/WizardShell";
import { AnimatedStep } from "@/components/onboarding/AnimatedStep";
import { InstallProgressBar } from "@/components/onboarding/InstallProgressBar";
import { useWizard } from "@/components/onboarding/useWizard";
import { Button } from "@/components/ui/button";
import { StepWelcome } from "@/components/onboarding/host/StepWelcome";
import {
  StepPermissions,
  type PermState,
} from "@/components/onboarding/host/StepPermissions";
import { StepWaiting, type ConnectedClient } from "@/components/onboarding/host/StepWaiting";
import { StepDone } from "@/components/onboarding/host/StepDone";

const STEP_TITLES = ["Welcome", "Permissions", "Waiting", "Done"];

export default function App() {
  const w = useWizard(4);
  const [perm, setPerm] = useState<PermState>({
    ax: "pending",
    sr: "pending",
    fda: "pending",
  });
  const [connected, setConnected] = useState<ConnectedClient | null>(null);
  const [installStarted, setInstallStarted] = useState(false);

  // Real install progress, derived from polling the host's runtime state.
  const [installLabel, setInstallLabel] = useState("Starting…");
  const [installPct, setInstallPct] = useState(10);
  const [installDone, setInstallDone] = useState(false);

  // Once the install has been triggered, poll the host for its real progress and
  // map (appAlive, launchAgentPresent, serverUp) → label + percent. Done when the
  // tmux socket (serverUp) appears.
  useEffect(() => {
    if (!installStarted) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const s = await window.remotepair.getInstallStatus();
        if (cancelled) return;
        if (s.serverUp) {
          setInstallLabel("Ready");
          setInstallPct(100);
          setInstallDone(true);
        } else if (s.launchAgentPresent) {
          setInstallLabel("Configuring launchd");
          setInstallPct(75);
        } else if (s.appAlive) {
          setInstallLabel("Installing helper");
          setInstallPct(40);
        } else {
          setInstallLabel("Starting…");
          setInstallPct(10);
        }
      } catch {
        // host not reachable yet — leave the current progress untouched.
      }
    };

    poll();
    const id = setInterval(poll, 800);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [installStarted]);

  // Real grant state, updated by the polling effect inside StepPermissions.
  const allGranted = useMemo(
    () => (Object.values(perm) as PermState[keyof PermState][]).every((s) => s === "granted"),
    [perm],
  );

  const nextDisabled = w.index === 1 && (!allGranted || !installDone);

  const handleNext = useCallback(() => {
    if (w.index === 0) {
      setInstallStarted(true);
      window.remotepair.startInstall();
    }
    w.next();
  }, [w.index, w.next]);

  return (
    <WizardShell
      title="RemotePairHost"
      subtitle={STEP_TITLES[w.index]}
      step={w.index}
      totalSteps={w.totalSteps}
      onPrev={w.prev}
      onNext={w.isLast ? undefined : handleNext}
      nextDisabled={nextDisabled}
      nextLabel={
        w.index === 0
          ? "Begin setup"
          : w.index === 2
          ? connected
            ? "Continue"
            : "Skip"
          : "Next"
      }
      footerSlot={
        w.isLast ? (
          <Button size="sm" onClick={() => window.remotepair.complete()}>
            Open RemotePair
          </Button>
        ) : null
      }
      centerSlot={
        w.index === 1 || w.index === 2 || w.index === 3 ? null : installStarted ? (
          <InstallProgressBar label={installLabel} percent={installPct} />
        ) : null
      }
    >
      <AnimatedStep stepKey={w.index} direction={w.direction}>
        {w.index === 0 && <StepWelcome />}
        {w.index === 1 && (
          <StepPermissions
            state={perm}
            setState={setPerm}
            installStarted={installStarted}
            installLabel={installLabel}
            installPct={installPct}
          />
        )}
        {w.index === 2 && (
          <StepWaiting
            connected={connected}
            onSimulate={() =>
              setConnected({
                name: "gh-mac-m4.local",
                ip: "192.168.1.18",
                user: "ghyeong",
              })
            }
          />
        )}
        {w.index === 3 && <StepDone paired={!!connected} />}
      </AnimatedStep>
    </WizardShell>
  );
}
