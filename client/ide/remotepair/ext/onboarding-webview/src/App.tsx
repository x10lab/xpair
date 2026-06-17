import { useCallback, useEffect, useState } from "react";
import { WizardShell } from "@/components/onboarding/WizardShell";
import { AnimatedStep } from "@/components/onboarding/AnimatedStep";
import { useWizard } from "@/components/onboarding/useWizard";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { StepWelcome } from "@/components/onboarding/client/StepWelcome";
import { StepConsent } from "@/components/onboarding/client/StepConsent";
import {
  StepConnect,
  type ConnState,
} from "@/components/onboarding/client/StepConnect";
import {
  StepFileAccess,
  type Mapping,
} from "@/components/onboarding/client/StepFileAccess";
import { StepDone } from "@/components/onboarding/client/StepDone";
import { StepDiscover } from "@/components/onboarding/client/StepDiscover";
import { StepConnectPin, type PinState } from "@/components/onboarding/client/StepConnectPin";
import { StepSetupPassword } from "@/components/onboarding/client/StepSetupPassword";
import {
  StepInstalling,
  type InstallState,
} from "@/components/onboarding/client/StepInstalling";
import type { Peer } from "@/global";
import { capture, EVENTS } from "@/lib/telemetry";

// Step indices for the discovery flow:
//   0 Welcome → 1 Before you start (consent) → 2 Discover → 3 Connect/Setup (auto-branch)
//   → 4 Installing (setup path only) → 5 File access & mapping → 6 Done (liveness-gated on every path).
const STEP_TITLES = [
  "Welcome",
  "Before you start",
  "Find your host",
  "Connect",
  "Set up host",
  "File access & mapping",
  "Done",
];

const S = {
  WELCOME: 0,
  CONSENT: 1,
  DISCOVER: 2,
  CONNECT: 3,
  INSTALL: 4,
  MAPPINGS: 5,
  DONE: 6,
} as const;

type LiveState = "idle" | "checking" | "reachable" | "rekeyed" | "offline";

export default function App() {
  const w = useWizard(7);

  // onboarding_started — fired once when the onboarding webview mounts (consent-gated no-op
  // otherwise). StrictMode double-invokes effects in dev, but the production build mounts once.
  useEffect(() => {
    capture(EVENTS.ONBOARDING_STARTED);
  }, []);

  // Discovery / pairing state.
  const [peer, setPeer] = useState<Peer | null>(null);
  const [account, setAccount] = useState("");
  // Account password typed on the setup step → consumed by StepInstalling (handed to the CLI over a
  // pipe, never argv/log), then cleared. Empty ⇒ install authenticates by SSH key.
  const [password, setPassword] = useState("");
  const [pinState, setPinState] = useState<PinState>("idle");
  const [installState, setInstallState] = useState<InstallState>("idle");
  const [live, setLive] = useState<LiveState>("idle");

  // Manual-entry fallback reuses the existing StepConnect machine.
  const [manual, setManual] = useState(false);
  const [host, setHost] = useState("");
  const [connState, setConnState] = useState<ConnState>("idle");

  // File access & mapping (unchanged step component).
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
    const target = manual ? host : peer?.target || peer?.addrs?.[0] || peer?.name || "";
    if (!target) {
      setLive("offline");
      return;
    }
    setLive("checking");
    try {
      const r = await window.remotepair.sshReachable(target);
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
  }, [manual, host, peer, w]);

  // Per-step Next gating (mirror of the existing readyToProceed idiom).
  const manualReady = connState === "reachable";
  const connectReady = manual
    ? manualReady
    : isSetup
    ? true // Setup path: Next moves on to Installing.
    : pinState === "paired";
  const installReady = installState === "done";
  const mappingsReady = mappings.length >= 1;

  const nextDisabled =
    w.index === S.DISCOVER || // Discover advances by picking a peer, not Next.
    (w.index === S.CONNECT && !connectReady) ||
    (w.index === S.INSTALL && !installReady) ||
    (w.index === S.MAPPINGS && !mappingsReady);

  // Custom Next routing: Mappings → run liveness check before Done; Connect (non-setup) skips the
  // Installing step.
  const onNext = () => {
    if (w.index === S.CONNECT && !isSetup) {
      // PIN / reconnect path and manual path both skip the Installing step.
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

  // Unified action label — always "Next" (no step-specific phrases); only the in-flight liveness
  // check on the Mappings step swaps in a transient "Checking…".
  const nextLabel =
    w.index === S.MAPPINGS && live === "checking" ? "Checking…" : "Next";

  return (
    <>
    <WizardShell
      title="RemotePair"
      subtitle={STEP_TITLES[w.index]}
      step={w.index}
      totalSteps={w.totalSteps}
      onPrev={onPrev}
      onNext={w.isLast || w.index === S.DISCOVER ? undefined : onNext}
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
        {w.index === S.CONSENT && <StepConsent />}
        {w.index === S.DISCOVER && (
          <StepDiscover onSelect={onSelectPeer} onManual={onManual} />
        )}
        {w.index === S.CONNECT &&
          (manual || !peer ? (
            <StepConnect
              host={host}
              setHost={setHost}
              state={connState}
              setState={setConnState}
            />
          ) : isSetup ? (
            <StepSetupPassword
              peer={peer}
              user={account}
              setUser={setAccount}
              password={password}
              setPassword={setPassword}
            />
          ) : (
            <StepConnectPin peer={peer} state={pinState} setState={setPinState} />
          ))}
        {w.index === S.INSTALL && peer && (
          <StepInstalling
            peer={peer}
            user={account}
            password={password}
            setPassword={setPassword}
            state={installState}
            setState={setInstallState}
          />
        )}
        {w.index === S.MAPPINGS && (
          <StepFileAccess mappings={mappings} setMappings={setMappings} />
        )}
        {w.index === S.DONE && (
          <StepDone host={manual ? host : peer?.name || ""} mappings={mappings} />
        )}
      </AnimatedStep>
    </WizardShell>
      {/* Build stamp — confirms a launched window is the latest build. */}
      <div className="pointer-events-none fixed bottom-1 left-2 z-50 select-none font-mono text-[10px] text-muted-foreground/40">
        build {__BUILD_ID__}
      </div>
    </>
  );
}
