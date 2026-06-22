import { useCallback, useEffect, useState } from "react";
import { WizardShell } from "@/components/onboarding/WizardShell";
import { AnimatedStep } from "@/components/onboarding/AnimatedStep";
import { useWizard } from "@/components/onboarding/useWizard";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
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
import { StepEngine } from "@/components/onboarding/client/StepEngine";
import type { EngineId, Peer } from "@/global";
import { capture, EVENTS } from "@/lib/telemetry";

// Step indices for the discovery flow:
//   0 Welcome → 1 Before you start (consent) → 2 Discover → 3 Connect/Setup (auto-branch)
//   → 4 Installing (setup path only, auto-advances) → 5 Grant permissions (setup path only)
//   → 6 Choose engine (host engine install/auth hard guard) → 7 File access & mapping
//   → 8 Done (liveness-gated on every path).
const STEP_TITLES = [
  "Welcome",
  "Before you start",
  "Find your host",
  "Connect",
  "Set up host",
  "Grant permissions",
  "Choose engine",
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
  ENGINE: 6,
  MAPPINGS: 7,
  DONE: 8,
} as const;

type LiveState = "idle" | "checking" | "reachable" | "rekeyed" | "offline";

// CLI readiness — needed only by the CLI-dependent steps (Discover/Connect/Mappings), which shell
// out to the `xpair` CLI. The CLI-free steps (Welcome/Consent/Installing/Grant) run regardless;
// while the user is on those we install the bundled CLI in the BACKGROUND (status bar feedback),
// and a hard gate only kicks in when the user reaches a step that actually needs it. null = not
// yet checked.
type CliState = { ready: boolean; err: string } | null;
// CLI-dependent steps (gate Next only on these): Discover (`xpair discover`), Connect
// (`config set host` / host-app SSH probe), Engine (`config set engine` + host SSH probes),
// Mappings (`map add`/`mount`/`map list`).
const CLI_DEPENDENT_STEPS: ReadonlySet<number> = new Set([
  S.DISCOVER,
  S.CONNECT,
  S.ENGINE,
  S.MAPPINGS,
]);
// Per-host app readiness, checked on the Connect/Reconnect step. null = not yet checked.
type HostAppState =
  | { installed: boolean; version: string; compatible: boolean; err: string }
  | null;

export default function App() {
  const w = useWizard(9);

  // onboarding_started — fired once when the onboarding webview mounts (consent-gated no-op
  // otherwise). StrictMode double-invokes effects in dev, but the production build mounts once.
  useEffect(() => {
    capture(EVENTS.ONBOARDING_STARTED);
  }, []);

  // CLI readiness — re-checked on mount, on window focus, and every 10s while the wizard is open.
  // No longer a global wall: ready===false only gates the CLI-dependent steps (see nextDisabled).
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
  const cliReady = cli?.ready === true;
  const cliMissing = !cliReady;
  const cliNeedsInstall = cli !== null && !cli.ready;

  // No dead end: when the CLI is missing we install the BUNDLED CLI (install.sh --role client) in the
  // BACKGROUND while the user proceeds through the CLI-free intro steps. Progress is surfaced in a
  // bottom status bar — onboarding is NEVER blocked by the install itself; only the CLI-dependent
  // steps gate their Next until the CLI is ready (or show the install-failure reason).
  type InstallCliState = "idle" | "installing" | "ready" | "failed";
  const [cliInstall, setCliInstall] = useState<InstallCliState>("idle");
  const [cliInstallErr, setCliInstallErr] = useState("");
  const installCliNow = useCallback(async () => {
    setCliInstall("installing");
    setCliInstallErr("");
    try {
      const r = await window.remotepair.installCli();
      if (!r.ok) {
        setCliInstallErr(r.err || "install failed");
        setCliInstall("failed");
        return;
      }
      // Re-confirm via the real liveness probe — never trust the installer's exit code alone.
      const probe = await window.remotepair.cliReady();
      setCli({ ready: !!probe.ready, err: probe.err || "" });
      if (probe.ready) {
        setCliInstall("ready");
      } else {
        setCliInstallErr(probe.err || "xpair still not runnable after install");
        setCliInstall("failed");
      }
    } catch (e) {
      setCliInstallErr(String(e));
      setCliInstall("failed");
    }
  }, []);

  // Kick off the background install the moment the probe reports the CLI missing (once per missing
  // edge). If a later probe flips the CLI back to missing after a "ready"/"failed", re-arm.
  useEffect(() => {
    if (cliNeedsInstall && cliInstall === "idle") void installCliNow();
  }, [cliNeedsInstall, cliInstall, installCliNow]);
  useEffect(() => {
    // CLI became ready by some other means (already installed / installed out-of-band) → clear any
    // stale failed/ready status so the bar disappears.
    if (!cliNeedsInstall && cliInstall !== "idle") setCliInstall("idle");
  }, [cliNeedsInstall, cliInstall]);

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

  // Engine selection + host-engine readiness, lifted from the Engine step so Next stays HARD-GATED
  // until the chosen engine is installed AND authenticated on the host.
  const [engine, setEngine] = useState<EngineId>("claude");
  const [engineReady, setEngineReady] = useState(false);

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
  const isConnect = peer?.status === "connect";
  const isSetup = !!peer && !isReconnect && !isConnect;

  // Peer chosen on the Discover step → reset per-path state and advance to Connect/Setup.
  const onSelectPeer = useCallback(
    (p: Peer) => {
      if (!cliReady) return;
      setManual(false);
      setPeer(p);
      setHost(p.status === "connect" ? p.target || p.addrs?.[0] || p.name || "" : "");
      setConnState("idle");
      setInstallState("idle");
      setReconnectReady(false);
      setLive("idle");
      w.goTo(S.CONNECT, "next");
    },
    [cliReady, w],
  );

  const onManual = useCallback(() => {
    if (!cliReady) return;
    setManual(true);
    setPeer(null);
    w.goTo(S.CONNECT, "next");
  }, [cliReady, w]);

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
    : isConnect
    ? manualReady
    : true;
  // The SSH target for the host-app probe on the non-setup paths.
  const connectTarget = manual || isConnect
    ? host.trim()
    : peer?.target || peer?.addrs?.[0] || peer?.name || "";
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
  // CLI hard gate — ONLY on the CLI-dependent steps, and ONLY when the CLI isn't ready yet. On the
  // CLI-free intro/setup steps the install runs in the background and never blocks Next.
  const cliGateActive = CLI_DEPENDENT_STEPS.has(w.index) && cliMissing;
  const cliGateMessage =
    cli === null
      ? "checking xpair CLI…"
      : cliInstall === "failed"
      ? `xpair CLI install failed — ${cliInstallErr || cli.err || "see status bar"}`
      : cliInstall === "installing"
      ? "installing xpair CLI…"
      : "waiting for xpair CLI…";
  const nextDisabled =
    cliGateActive || // wait for the background xpair CLI install on CLI-dependent steps.
    w.index === S.DISCOVER || // Discover advances by picking a peer, not Next.
    (w.index === S.CONNECT && (!connectReady || hostAppChecking)) ||
    (w.index === S.GRANT && !grantReady) || // wait until host AX + SR are granted
    (w.index === S.ENGINE && !engineReady); // wait until the engine is installed + authed on the host
  // Folder mappings are OPTIONAL — you can attach to a host for screen share / terminal without
  // mapping any folders and add them later from the IDE ("Add Root"), so the Mappings step never
  // blocks Next.

  // Custom Next routing: Mappings → run liveness check before Done; Connect (non-setup) skips the
  // Installing step.
  const onNext = () => {
    if (w.index === S.CONNECT && !isSetup) {
      // Reconnect path and manual path both skip the Installing + Grant steps → straight to Engine.
      w.goTo(S.ENGINE, "next");
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
      // Mappings always follows the Engine step.
      w.goTo(S.ENGINE, "prev");
      return;
    }
    if (w.index === S.ENGINE) {
      // Engine follows Grant on the setup path, Connect on the reconnect/manual paths.
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
        // CLI-dependent step blocked because the bundled CLI isn't ready yet — say why (installing
        // vs failed) so the disabled Next isn't a mystery.
        cliGateActive ? (
          <p className="truncate text-center text-xs text-muted-foreground">
            {cliGateMessage}
          </p>
        ) : // Connect step: once reachable, surface WHY the host-app gate blocks (not installed /
        // incompatible) so the user isn't staring at a silently-disabled Next.
        requiresHostApp && reachReady && hostApp && !hostAppReady && !hostAppChecking ? (
          <p className="truncate text-center text-xs text-destructive">
            {!hostApp.installed
              ? "Host has no Xpair host app — install it on the host."
              : hostApp.err || "Host version is incompatible with this client."}
          </p>
        ) : w.index === S.ENGINE && !engineReady ? (
          <p className="truncate text-center text-xs text-muted-foreground">
            Set up {engine} on the host to continue.
          </p>
        ) : w.index === S.MAPPINGS && (live === "offline" || live === "rekeyed") ? (
          <p className="truncate text-center text-xs text-destructive">
            {live === "rekeyed"
              ? "Host identity changed — re-pair."
              : "Host unreachable — re-discover."}
          </p>
        ) : null
      }
      statusBar={
        // Background CLI install progress — a thin, non-blocking bar at the very bottom of the
        // wizard. Shown only while the install is in flight, just succeeded, or failed; the
        // onboarding stays fully interactive throughout.
        cliInstall === "installing" ? (
          <div className="flex items-center gap-2 border-t border-border/60 bg-muted/30 px-6 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Installing xpair CLI…</span>
          </div>
        ) : cliInstall === "ready" ? (
          <div className="flex items-center gap-2 border-t border-border/60 bg-muted/30 px-6 py-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span>xpair CLI ready</span>
          </div>
        ) : cliInstall === "failed" ? (
          <div className="flex items-center gap-2 border-t border-destructive/30 bg-destructive/10 px-6 py-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              CLI install failed{(cliInstallErr || cli?.err) ? ` — ${cliInstallErr || cli?.err}` : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={() => void installCliNow()}
            >
              Retry
            </Button>
          </div>
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
          <StepDiscover
            onSelect={onSelectPeer}
            onManual={onManual}
            cliBlocked={cliGateActive}
          />
        )}
        {w.index === S.CONNECT &&
          (manual || isConnect || !peer ? (
            <StepConnect
              host={host}
              setHost={setHost}
              state={connState}
              setState={setConnState}
              cliBlocked={cliGateActive}
            />
          ) : isReconnect ? (
            <StepReconnect peer={peer} onReady={setReconnectReady} />
          ) : (
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
        {w.index === S.ENGINE && (
          <StepEngine engine={engine} setEngine={setEngine} onReady={setEngineReady} />
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
