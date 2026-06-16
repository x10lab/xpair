import { useCallback, useEffect, useState } from "react";
import { WizardShell } from "@/components/onboarding/WizardShell";
import { AnimatedStep } from "@/components/onboarding/AnimatedStep";
import { useWizard } from "@/components/onboarding/useWizard";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { StepWelcome } from "@/components/onboarding/client/StepWelcome";
import { StepConnect, type ConnState } from "@/components/onboarding/client/StepConnect";
import { StepMappings, type Mapping } from "@/components/onboarding/client/StepMappings";
import { StepDone } from "@/components/onboarding/client/StepDone";
import { StepDiscover } from "@/components/onboarding/client/StepDiscover";
import { StepConnectPin, type PinState } from "@/components/onboarding/client/StepConnectPin";
import { StepSetupPassword } from "@/components/onboarding/client/StepSetupPassword";
import {
  StepInstalling,
  type InstallState,
} from "@/components/onboarding/client/StepInstalling";
import type { Peer } from "@/global";

// Step indices for the discovery flow:
//   0 Welcome → 1 Discover → 2 Connect/Setup (auto-branch) → 3 Installing (setup path only)
//   → 4 Mappings → 5 Done (liveness-gated on every path).
const STEP_TITLES = [
  "Welcome",
  "Find your host",
  "Connect",
  "Set up host",
  "Folder mappings",
  "Done",
];

const S = {
  WELCOME: 0,
  DISCOVER: 1,
  CONNECT: 2,
  INSTALL: 3,
  MAPPINGS: 4,
  DONE: 5,
} as const;

type LiveState = "idle" | "checking" | "reachable" | "rekeyed" | "offline";

export default function App() {
  const w = useWizard(6);

  // Discovery / pairing state.
  const [peer, setPeer] = useState<Peer | null>(null);
  const [account, setAccount] = useState("");
  const [pinState, setPinState] = useState<PinState>("idle");
  const [installState, setInstallState] = useState<InstallState>("idle");
  const [live, setLive] = useState<LiveState>("idle");

  // Manual-entry fallback reuses the existing StepConnect machine.
  const [manual, setManual] = useState(false);
  const [alias, setAlias] = useState("");
  const [connState, setConnState] = useState<ConnState>("idle");

  // Folder mappings (unchanged).
  const [mappings, setMappings] = useState<Mapping[]>([]);

  // Default the install account to this machine's username.
  useEffect(() => {
    void window.remotepair
      .hostInfo()
      .then((i) => setAccount((a) => a || i.user))
      .catch(() => {});
  }, []);

  const isSetup = peer?.status === "setup";

  // Peer chosen on the Discover step → reset per-path state and advance to Connect/Setup.
  const onSelectPeer = useCallback(
    (p: Peer) => {
      setManual(false);
      setPeer(p);
      setPinState("idle");
      setInstallState("idle");
      setLive("idle");
      w.goTo(S.CONNECT, "next");
    },
    [w],
  );

  const onManual = useCallback(() => {
    setManual(true);
    setPeer(null);
    w.goTo(S.CONNECT, "next");
  }, [w]);

  // Liveness gate before Done: ssh true + host-app/server reachability. Blocks landing Done on a
  // stale config to an offline host; flags a re-keyed host (TOFU mismatch) for re-pairing.
  const runLivenessCheck = useCallback(async () => {
    const host = manual ? alias : peer?.addrs?.[0] || peer?.name || "";
    if (!host) {
      setLive("offline");
      return;
    }
    setLive("checking");
    try {
      const r = await window.remotepair.sshReachable(host);
      if (r.reachable) {
        setLive("reachable");
        w.goTo(S.DONE, "next");
        return;
      }
      // A host-key mismatch surfaces as an ssh failure mentioning the host key; treat that as a
      // re-key (TOFU mismatch) so the user re-pairs instead of silently failing.
      setLive(/host key|REMOTE HOST IDENTIFICATION/i.test(r.err || "") ? "rekeyed" : "offline");
    } catch {
      setLive("offline");
    }
  }, [manual, alias, peer, w]);

  // Per-step Next gating (mirror of the existing readyToProceed idiom).
  const manualReady =
    connState === "connected_installed" || connState === "install_done";
  const connectReady = manual
    ? manualReady
    : isSetup
    ? true // Setup path: Next moves on to Installing.
    : pinState === "paired";
  const installReady = installState === "done";

  const nextDisabled =
    (w.index === S.DISCOVER) || // Discover advances by picking a peer, not Next.
    (w.index === S.CONNECT && !connectReady) ||
    (w.index === S.INSTALL && !installReady) ||
    (w.index === S.MAPPINGS && false);

  // Custom Next routing: Mappings → run liveness check before Done; Connect (non-setup) skips the
  // Installing step.
  const onNext = () => {
    if (w.index === S.CONNECT && !isSetup && !manual) {
      // PIN / reconnect path skips the Installing step.
      w.goTo(S.MAPPINGS, "next");
      return;
    }
    if (w.index === S.CONNECT && manual) {
      w.goTo(S.MAPPINGS, "next");
      return;
    }
    if (w.index === S.MAPPINGS) {
      void runLivenessCheck();
      return;
    }
    w.next();
  };

  // Prev routing: from Mappings, go back to Installing (setup) or Connect (others).
  const onPrev = () => {
    if (w.index === S.MAPPINGS) {
      w.goTo(isSetup && !manual ? S.INSTALL : S.CONNECT, "prev");
      return;
    }
    if (w.index === S.INSTALL) {
      w.goTo(S.CONNECT, "prev");
      return;
    }
    w.prev();
  };

  const nextLabel =
    w.index === S.WELCOME
      ? "Find my host"
      : w.index === S.MAPPINGS
      ? live === "checking"
        ? "Checking…"
        : "Finish"
      : "Next";

  return (
    <WizardShell
      title="RemotePair"
      subtitle={STEP_TITLES[w.index]}
      step={w.index}
      totalSteps={w.totalSteps}
      onPrev={onPrev}
      onNext={
        w.isLast || w.index === S.DISCOVER ? undefined : onNext
      }
      nextDisabled={nextDisabled || live === "checking"}
      nextLabel={nextLabel}
      centerSlot={
        w.index === S.MAPPINGS && (live === "offline" || live === "rekeyed") ? (
          <p className="truncate text-center text-xs text-destructive">
            {live === "rekeyed"
              ? "Host identity changed — re-pair."
              : "Host unreachable — re-discover."}
          </p>
        ) : null
      }
      footerSlot={
        w.isLast ? (
          <Button size="sm" onClick={() => window.remotepair.complete()}>
            Open RemotePair
          </Button>
        ) : w.index === S.MAPPINGS && live === "checking" ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (live === "offline" || live === "rekeyed") && w.index === S.MAPPINGS ? (
          <Button size="sm" variant="outline" onClick={() => w.goTo(S.DISCOVER, "prev")}>
            Re-discover
          </Button>
        ) : null
      }
    >
      <AnimatedStep stepKey={w.index} direction={w.direction}>
        {w.index === S.WELCOME && <StepWelcome />}
        {w.index === S.DISCOVER && (
          <StepDiscover onSelect={onSelectPeer} onManual={onManual} />
        )}
        {w.index === S.CONNECT &&
          (manual || !peer ? (
            <StepConnect
              alias={alias}
              setAlias={setAlias}
              state={connState}
              setState={setConnState}
            />
          ) : isSetup ? (
            <StepSetupPassword peer={peer} user={account} setUser={setAccount} />
          ) : (
            <StepConnectPin peer={peer} state={pinState} setState={setPinState} />
          ))}
        {w.index === S.INSTALL && peer && (
          <StepInstalling
            peer={peer}
            user={account}
            state={installState}
            setState={setInstallState}
          />
        )}
        {w.index === S.MAPPINGS && (
          <StepMappings mappings={mappings} setMappings={setMappings} />
        )}
        {w.index === S.DONE && (
          <StepDone hostAlias={manual ? alias : peer?.name || ""} mappings={mappings} />
        )}
      </AnimatedStep>
    </WizardShell>
  );
}
