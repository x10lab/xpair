import { useCallback, useEffect, useState } from "react";
import { WizardShell } from "@/components/onboarding/WizardShell";
import { AnimatedStep } from "@/components/onboarding/AnimatedStep";
import { useWizard } from "@/components/onboarding/useWizard";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldAlert } from "lucide-react";
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
import { StepReconnect } from "@/components/onboarding/client/StepReconnect";
import { StepSetupPassword } from "@/components/onboarding/client/StepSetupPassword";
import { StepGrantPermissions } from "@/components/onboarding/client/StepGrantPermissions";
import {
  StepInstalling,
  type InstallState,
} from "@/components/onboarding/client/StepInstalling";
import type { Peer } from "@/global";
import { capture, EVENTS } from "@/lib/telemetry";

// Step indices for the discovery flow:
//   0 Welcome → 1 Before you start (consent) → 2 Discover → 3 Connect/Setup (auto-branch)
//   → 4 Installing (setup path only, auto-advances) → 5 Grant permissions (setup path only)
//   → 6 File access & mapping → 7 Done (liveness-gated on every path).
const STEP_TITLES = [
  "Welcome",
  "Before you start",
  "Find your host",
  "Connect",
  "Set up host",
  "Grant permissions",
  "File access & mapping",
  "Done",
];

const S = {
  WELCOME: 0,
  CONSENT: 1,
  DISCOVER: 2,
  CONNECT: 3,
  INSTALL: 4,
  GRANT: 5,
  MAPPINGS: 6,
  DONE: 7,
} as const;

type LiveState = "idle" | "checking" | "reachable" | "rekeyed" | "offline";

// Global CLI readiness — the whole wizard shells out to the `xpair` CLI, so until it's confirmed
// installed + runnable every "real" step silently fails. null = not yet checked.
type CliState = { ready: boolean; err: string } | null;
// Per-host app readiness, checked on the Connect/Reconnect step. null = not yet checked.
type HostAppState =
  | { installed: boolean; version: string; compatible: boolean; err: string }
  | null;

export default function App() {
  const w = useWizard(8);

  // onboarding_started — fired once when the onboarding webview mounts (consent-gated no-op
  // otherwise). StrictMode double-invokes effects in dev, but the production build mounts once.
  useEffect(() => {
    capture(EVENTS.ONBOARDING_STARTED);
  }, []);

  // Global hard CLI guard — re-checked on mount, on window focus, and every 10s while the wizard is
  // open. When ready===false the wizard is fully blocked (every Next disabled + a blocking banner).
  const [cli, setCli] = useState<CliState>(null);
  useEffect(() => {
    let alive = true;
    const probe = async () => {
      try {
        const r = await window.remotepair.cliReady();
        if (alive) setCli({ ready: !!r.ready, err: r.err || "" });
      } catch (e) {
        if (alive) setCli({ ready: false, err: String(e) });
      }
    };
    void probe();
    const onFocus = () => void probe();
    window.addEventListener("focus", onFocus);
    const id = window.setInterval(probe, 10000);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, []);
  const cliBlocked = cli !== null && !cli.ready;

  // Per-host app guard (Connect/Reconnect): reachable is not enough — the host needs the host app
  // installed AND version-compatible. Only the non-setup paths (manual + reconnect) check this; the
  // setup path INSTALLS the app on the Installing step, so it must not be blocked for "not installed".
  const [hostApp, setHostApp] = useState<HostAppState>(null);
  const [hostAppChecking, setHostAppChecking] = useState(false);
  const checkHostApp = useCallback(async (target: string) => {
    if (!target) {
      setHostApp({ installed: false, version: "", compatible: false, err: "no host" });
      return;
    }
    setHostAppChecking(true);
    try {
      const r = await window.remotepair.hostAppStatus(target);
      setHostApp(r);
    } catch (e) {
      setHostApp({ installed: false, version: "", compatible: false, err: String(e) });
    } finally {
      setHostAppChecking(false);
    }
  }, []);

  // Discovery / connect state.
  const [peer, setPeer] = useState<Peer | null>(null);
  const [account, setAccount] = useState("");
  // Account password typed on the setup step → consumed by StepInstalling (handed to the CLI over a
  // pipe, never argv/log), then cleared. Empty ⇒ install authenticates by SSH key.
  const [password, setPassword] = useState("");
  const [installState, setInstallState] = useState<InstallState>("idle");
  // Host TCC grant readiness, lifted from the Grant step so Next stays gated until AX + SR are on.
  const [grantReady, setGrantReady] = useState(false);
  // Reconnect reachability, lifted from the Reconnect step so Next gates until the host answers.
  const [reconnectReady, setReconnectReady] = useState(false);
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

  // Reconnect: this client already authorized with the host (ssh-config entry) and the app is
  // installed, so there's nothing to install — just re-persist REMOTE_HOST and confirm reachability.
  const isReconnect = peer?.status === "reconnect";
  // Everything that is NOT a reconnect takes the account-password / install path (this covers the
  // old "setup" status AND the old PIN "connect" status — a running host whose key isn't authorized
  // yet). Any unknown status falls here too, so the UI never crashes on an unrecognized value.
  const isSetup = !!peer && !isReconnect;

  // Peer chosen on the Discover step → reset per-path state and advance to Connect/Setup.
  const onSelectPeer = useCallback(
    (p: Peer) => {
      setManual(false);
      setPeer(p);
      setInstallState("idle");
      setReconnectReady(false);
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
  // Reachability (SSH) for the non-setup paths. The setup path installs the app later, so it gates
  // only on the password step's own flow (Next → Installing), not on reachability/host-app here.
  const reachReady = manual
    ? manualReady
    : isReconnect
    ? reconnectReady
    : true;
  // The SSH target for the host-app probe on the non-setup paths.
  const connectTarget = manual ? host.trim() : peer?.target || peer?.addrs?.[0] || peer?.name || "";
  // The setup (install) path doesn't require the app to already exist — it installs it. For manual +
  // reconnect, the host app must be installed AND compatible before Next.
  const requiresHostApp = w.index === S.CONNECT && !isSetup;
  const hostAppReady =
    !requiresHostApp ||
    (!!hostApp && hostApp.installed && hostApp.compatible);

  // Once reachable on a non-setup path, probe the host app exactly once per (target, reachable) edge.
  useEffect(() => {
    if (requiresHostApp && reachReady && connectTarget) {
      void checkHostApp(connectTarget);
    } else if (!requiresHostApp || !reachReady) {
      // Leaving the gate (path change / no longer reachable) clears stale host-app state.
      setHostApp(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiresHostApp, reachReady, connectTarget]);

  const connectReady = reachReady && hostAppReady;
  const nextDisabled =
    cliBlocked || // global hard CLI guard — block every step until the CLI is installed + runnable.
    w.index === S.DISCOVER || // Discover advances by picking a peer, not Next.
    (w.index === S.CONNECT && (!connectReady || hostAppChecking)) ||
    (w.index === S.GRANT && !grantReady); // wait until host AX + SR are granted
  // Folder mappings are OPTIONAL — you can attach to a host for screen share / terminal without
  // mapping any folders and add them later from the IDE ("Add Root"), so the Mappings step never
  // blocks Next.

  // Custom Next routing: Mappings → run liveness check before Done; Connect (non-setup) skips the
  // Installing step.
  const onNext = () => {
    if (w.index === S.CONNECT && !isSetup) {
      // Reconnect path and manual path both skip the Installing step.
      w.goTo(S.MAPPINGS, "next");
      return;
    }
    if (w.index === S.MAPPINGS) {
      void runLivenessCheck();
      return;
    }
    w.next();
  };

  // Prev routing: from Mappings, go back to Grant (setup) or Connect (others); Grant and Installing
  // both fall back to the setup/password step.
  const onPrev = () => {
    if (w.index === S.MAPPINGS) {
      w.goTo(isSetup && !manual ? S.GRANT : S.CONNECT, "prev");
      return;
    }
    if (w.index === S.GRANT || w.index === S.INSTALL) {
      w.goTo(S.CONNECT, "prev");
      return;
    }
    w.prev();
  };

  // Unified action label — always "Next" (no step-specific phrases); only the in-flight liveness
  // check on the Mappings step swaps in a transient "Checking…".
  const nextLabel =
    w.index === S.MAPPINGS && live === "checking"
      ? "Checking…"
      : w.index === S.MAPPINGS && mappings.length === 0
      ? "Skip for now"
      : "Next";

  return (
    <>
    <WizardShell
      title="Xpair"
      subtitle={STEP_TITLES[w.index]}
      step={w.index}
      totalSteps={w.totalSteps}
      onPrev={onPrev}
      onNext={
        w.isLast || w.index === S.DISCOVER || w.index === S.INSTALL ? undefined : onNext
      }
      nextDisabled={nextDisabled || live === "checking"}
      nextLabel={nextLabel}
      centerSlot={
        // Connect step: once reachable, surface WHY the host-app gate blocks (not installed /
        // incompatible) so the user isn't staring at a silently-disabled Next.
        requiresHostApp && reachReady && hostApp && !hostAppReady && !hostAppChecking ? (
          <p className="truncate text-center text-xs text-destructive">
            {!hostApp.installed
              ? "Host has no Xpair host app — install it on the host."
              : hostApp.err || "Host version is incompatible with this client."}
          </p>
        ) : w.index === S.MAPPINGS && (live === "offline" || live === "rekeyed") ? (
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
            Open Xpair
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
          ) : isReconnect ? (
            <StepReconnect peer={peer} onReady={setReconnectReady} />
          ) : (
            // Everything else (old "setup" + old PIN "connect" + unknown status) → password path.
            <StepSetupPassword
              peer={peer}
              user={account}
              setUser={setAccount}
              password={password}
              setPassword={setPassword}
            />
          ))}
        {w.index === S.INSTALL && peer && (
          <StepInstalling
            peer={peer}
            user={account}
            password={password}
            setPassword={setPassword}
            state={installState}
            setState={setInstallState}
            onDone={() => {
              setGrantReady(false);
              w.goTo(S.GRANT, "next");
            }}
            onFail={() => w.goTo(S.CONNECT, "prev")}
          />
        )}
        {w.index === S.GRANT && peer && (
          <StepGrantPermissions peer={peer} user={account} onReady={setGrantReady} />
        )}
        {w.index === S.MAPPINGS && (
          <StepFileAccess mappings={mappings} setMappings={setMappings} />
        )}
        {w.index === S.DONE && (
          <StepDone host={manual ? host : peer?.name || ""} mappings={mappings} />
        )}
      </AnimatedStep>
    </WizardShell>
      {/* Global hard CLI guard — a full-bleed blocking overlay. While the `xpair` CLI is missing or
          unrunnable, EVERY step's Next is already disabled (nextDisabled); this overlay makes the
          reason unmissable and unbypassable (you cannot proceed by guessing). */}
      {cliBlocked && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/85 p-6 backdrop-blur-sm">
          <div className="max-w-sm rounded-2xl border border-destructive/30 bg-card p-6 text-center shadow-xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              Xpair CLI not installed
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The setup wizard drives the <span className="font-mono">xpair</span> command-line tool.
              Install it to continue — onboarding can't proceed without it.
            </p>
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-left">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Install
              </p>
              <code className="mt-1 block break-words font-mono text-xs text-foreground">
                bash shared/install.sh --role client
              </code>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Then re-run setup. Expected at{" "}
                <span className="font-mono">~/.local/bin/xpair</span>.
              </p>
            </div>
            {cli?.err && (
              <p className="mt-3 break-words font-mono text-[11px] text-destructive/80">
                {cli.err}
              </p>
            )}
          </div>
        </div>
      )}
      {/* Build stamp — confirms a launched window is the latest build. */}
      <div className="pointer-events-none fixed bottom-1 left-2 z-50 select-none font-mono text-[10px] text-muted-foreground/40">
        build {__BUILD_ID__}
      </div>
    </>
  );
}
