import { useCallback, useEffect, useRef, useState } from "react";
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
//   → 4 Installing (setup path only, auto-advances on success) → 5 Grant permissions (setup path only)
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

// Warning copy only. Keep in sync with onboarding-bridge.js MIN_COMPATIBLE_HOST.
const MIN_COMPATIBLE_HOST = "0.5.0a51";

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

const START_STEPS: Record<string, number> = {
  welcome: S.WELCOME,
  consent: S.CONSENT,
  discover: S.DISCOVER,
  connect: S.CONNECT,
  install: S.INSTALL,
  grant: S.GRANT,
  engine: S.ENGINE,
  mappings: S.MAPPINGS,
  done: S.DONE,
};

const ENGINE_IDS = new Set<EngineId>(["claude", "shell", "codex", "opencode"]);

function isEngineId(value: string): value is EngineId {
  return ENGINE_IDS.has(value as EngineId);
}

function initialStepFromLocation() {
  if (typeof window === "undefined") return S.WELCOME;
  const raw = new URLSearchParams(window.location.search).get("startStep") || "";
  if (Object.prototype.hasOwnProperty.call(START_STEPS, raw)) return START_STEPS[raw];
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= S.WELCOME && numeric <= S.DONE) return numeric;
  return S.WELCOME;
}

function engineFromLocation(): EngineId {
  if (typeof window === "undefined") return "claude";
  const raw = new URLSearchParams(window.location.search).get("engine") || "";
  return isEngineId(raw) ? raw : "claude";
}

function isHostKeyMismatch(err: string, state?: string): boolean {
  return (
    state === "host_key_mismatch" ||
    /host key|known_hosts|REMOTE HOST IDENTIFICATION|offending .*key|key verification/i.test(err)
  );
}

type LiveState =
  | "idle"
  | "checking"
  | "reachable"
  | "rekeyed"
  | "offline"
  | "setup"
  | "host-app"
  | "permissions";

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
  | {
      target: string;
      installed: boolean;
      version: string;
      compatible: boolean;
      // WHY incompatible — below_floor is a safe same-major update; major_mismatch stays blocked.
      incompatibleKind: "below_floor" | "major_mismatch" | "";
      err: string;
    }
  | null;
type HostPermState =
  | { target: string; alive: boolean; ax: boolean; sr: boolean; fda: boolean; err: string }
  | null;

export default function App() {
  const [initialStep] = useState(() => initialStepFromLocation());
  const w = useWizard(9, initialStep);
  const startsFromSavedHost = initialStep >= S.CONNECT && initialStep <= S.ENGINE;
  const lockConfiguredEngine = startsFromSavedHost;

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
  // cliReady: the CLI probe has returned and reports runnable. cliMissing gates the CLI-dependent
  // steps whenever the CLI isn't proven ready (including the not-yet-checked null state, so Next
  // can't slip through before the first probe). cliNeedsInstall is the narrower "probed AND not
  // ready" edge that arms the background install.
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
  const hostAppProbeId = useRef(0);
  const [hostPerms, setHostPerms] = useState<HostPermState>(null);
  const [hostPermChecking, setHostPermChecking] = useState(false);
  const checkHostApp = useCallback(async (target: string) => {
    const probeId = ++hostAppProbeId.current;
    if (!target) {
      setHostAppChecking(false);
      setHostApp({ target, installed: false, version: "", compatible: false, incompatibleKind: "", err: "no host" });
      return;
    }
    setHostAppChecking(true);
    try {
      const r = await window.remotepair.hostAppStatus(target);
      if (hostAppProbeId.current === probeId) setHostApp({ target, ...r });
    } catch (e) {
      if (hostAppProbeId.current === probeId) {
        setHostApp({ target, installed: false, version: "", compatible: false, incompatibleKind: "", err: String(e) });
      }
    } finally {
      if (hostAppProbeId.current === probeId) setHostAppChecking(false);
    }
  }, []);

  // Discovery / connect state.
  const [peer, setPeer] = useState<Peer | null>(null);
  const [account, setAccount] = useState("");
  // Setup path readiness: the fingerprint-confirm step must prepare/reuse the client SSH key and
  // fetch the host fingerprint before Next starts the key-auth install.
  const [setupReady, setSetupReady] = useState(false);
  const [setupFp, setSetupFp] = useState<string | null>(null);
  const [setupPinErr, setSetupPinErr] = useState("");
  const [setupPinning, setSetupPinning] = useState(false);
  const [setupPinnedKey, setSetupPinnedKey] = useState("");
  const setupPinningRef = useRef(false);
  const [durableHostKey, setDurableHostKey] = useState<{
    target: string;
    present: boolean;
    err: string;
  } | null>(null);
  const [durableHostKeyChecking, setDurableHostKeyChecking] = useState(false);
  const durableHostKeyProbeId = useRef(0);
  const [installState, setInstallState] = useState<InstallState>("idle");
  // Host TCC grant readiness, lifted from the Grant step so Next stays gated until AX + SR are on.
  const [grantReady, setGrantReady] = useState(false);
  // Reconnect reachability, lifted from the Reconnect step so Next gates until the host answers.
  const [reconnectReady, setReconnectReady] = useState(false);
  const [live, setLive] = useState<LiveState>("idle");
  const [liveErr, setLiveErr] = useState("");
  const stepRef = useRef(w.index);
  stepRef.current = w.index;
  const livenessCheckId = useRef(0);
  const cancelLivenessCheck = useCallback(() => {
    livenessCheckId.current += 1;
  }, []);
  useEffect(() => {
    if (w.index !== S.MAPPINGS) cancelLivenessCheck();
  }, [w.index, cancelLivenessCheck]);

  // Manual-entry fallback reuses the existing StepConnect machine.
  const [savedHost, setSavedHost] = useState("");
  const [manual, setManual] = useState(initialStep === S.CONNECT);
  const [host, setHost] = useState("");
  const [connState, setConnState] = useState<ConnState>("idle");

  // Engine selection + host-engine readiness, lifted from the Engine step so Next stays HARD-GATED
  // until the chosen engine is installed AND authenticated on the host.
  const [engine, setEngine] = useState<EngineId>(() => engineFromLocation());
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

  // Parachuted launches start from saved client.env state rather than a freshly discovered peer.
  // Hydrate the smallest peer shape needed by the existing Grant/Engine back-navigation paths.
  useEffect(() => {
    if (!startsFromSavedHost) return;
    let active = true;
    void window.remotepair
      .getConfig()
      .then((cfg) => {
        const hydratedHost = cfg.remoteHost.trim();
        if (!active || !hydratedHost) return;
        setSavedHost((current) => current || hydratedHost);
        setHost((current) => current || hydratedHost);
        if (initialStep === S.GRANT || initialStep === S.ENGINE) {
          setPeer((current) =>
            current || {
              name: hydratedHost,
              addrs: [hydratedHost],
              target: hydratedHost,
              source: "ssh",
              sources: ["ssh"],
              fp: null,
              status: "reconnect",
            },
          );
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [initialStep, startsFromSavedHost]);

  // Reconnect: this client already authorized with the host (ssh-config entry) and the app is
  // installed, so there's nothing to install — just re-persist REMOTE_HOST and confirm reachability.
  const isReconnect = peer?.status === "reconnect";
  const isConnect = peer?.status === "connect";
  const isSetup = !!peer && !isReconnect && !isConnect;
  const currentTarget = manual ? host.trim() : peer?.target || peer?.addrs?.[0] || peer?.name || "";
  const currentTargetRef = useRef(currentTarget);
  currentTargetRef.current = currentTarget;

  // Peer chosen on the Discover step → reset per-path state and advance to Connect/Setup.
  const onSelectPeer = useCallback(
    (p: Peer) => {
      if (!cliReady) return;
      setManual(false);
      setPeer(p);
      setHost(p.status === "connect" ? p.target || p.addrs?.[0] || p.name || "" : "");
      setSetupReady(false);
      setSetupFp(null);
      setSetupPinErr("");
      setSetupPinnedKey("");
      setupPinningRef.current = false;
      setSetupPinning(false);
      durableHostKeyProbeId.current += 1;
      setDurableHostKey(null);
      setDurableHostKeyChecking(false);
      setConnState("idle");
      hostAppProbeId.current += 1;
      setHostApp(null);
      setHostAppChecking(false);
      setHostPerms(null);
      setInstallState("idle");
      setReconnectReady(false);
      setLive("idle");
      setLiveErr("");
      stepRef.current = S.CONNECT;
      w.goTo(S.CONNECT, "next");
    },
    [cliReady, w],
  );

  const onManual = useCallback(() => {
    setManual(true);
    setPeer(null);
    setSetupReady(false);
    setSetupFp(null);
    setSetupPinErr("");
    setSetupPinnedKey("");
    setupPinningRef.current = false;
    setSetupPinning(false);
    durableHostKeyProbeId.current += 1;
    setDurableHostKey(null);
    setDurableHostKeyChecking(false);
    hostAppProbeId.current += 1;
    setHostApp(null);
    setHostAppChecking(false);
    setHostPerms(null);
    setInstallState("idle");
    setLive("idle");
    setLiveErr("");
    stepRef.current = S.CONNECT;
    w.goTo(S.CONNECT, "next");
  }, [w]);

  // Final gate before Done: the earlier steps keep the user moving, but Done only opens after fresh
  // setup, host-app, permission, and SSH liveness probes all pass.
  const runLivenessCheck = useCallback(async () => {
    const target = currentTargetRef.current;
    const checkId = ++livenessCheckId.current;
    const stillCurrent = () =>
      livenessCheckId.current === checkId &&
      stepRef.current === S.MAPPINGS &&
      currentTargetRef.current === target;
    if (stepRef.current !== S.MAPPINGS) return;
    if (!target) {
      setLiveErr("No host selected.");
      setLive("offline");
      return;
    }
    setLive("checking");
    setLiveErr("");

    if (isSetup && installState !== "done") {
      setLiveErr("Host setup has not finished. Go back and retry setup.");
      setLive("setup");
      return;
    }

    try {
      const app = await window.remotepair.hostAppStatus(target);
      if (!stillCurrent()) return;
      setHostApp({ target, ...app });
      if (app.installed && !app.compatible) {
        setLiveErr(app.err || "Host version is incompatible with this client.");
        setLive("host-app");
        return;
      }
      if (!app.installed) {
        setLiveErr("Host has no Xpair host app. Install it on the host before finishing.");
        setLive("host-app");
        return;
      }
    } catch (e) {
      if (!stillCurrent()) return;
      setLiveErr(`Host app check failed: ${String(e)}`);
      setLive("host-app");
      return;
    }

    try {
      const perms = await window.remotepair.hostPermissions({ host: target });
      if (!stillCurrent()) return;
      const ready = perms.alive && perms.ax && perms.sr;
      setGrantReady(ready);
      if (!ready) {
        setLiveErr(
          perms.err ||
            (!perms.alive
              ? "Host app is not reporting permission status."
              : "Grant Accessibility and Screen Recording on the host before finishing."),
        );
        setLive("permissions");
        return;
      }
    } catch (e) {
      if (!stillCurrent()) return;
      setGrantReady(false);
      setLiveErr(`Permission check failed: ${String(e)}`);
      setLive("permissions");
      return;
    }

    try {
      const r = await window.remotepair.sshReachable(target);
      if (!stillCurrent()) return;
      if (r.reachable) {
        setLive("reachable");
        stepRef.current = S.DONE;
        w.goTo(S.DONE, "next");
        return;
      }
      // A host-key mismatch surfaces as an ssh failure mentioning the host key; treat that as a
      // re-key (TOFU mismatch) so the user re-pairs instead of silently failing.
      setLiveErr(r.err || "Host did not respond.");
      setLive(/host key|REMOTE HOST IDENTIFICATION/i.test(r.err || "") ? "rekeyed" : "offline");
    } catch (e) {
      if (!stillCurrent()) return;
      setLiveErr(`Liveness check failed: ${String(e)}`);
      setLive("offline");
    }
  }, [isSetup, installState, w]);

  // Per-step Next gating (mirror of the existing readyToProceed idiom).
  const manualReady = connState === "reachable";
  // Reachability (SSH) for the non-setup paths. The setup path installs the app later, so it gates
  // on the fingerprint-confirm/key-prep step before Installing, not on host-app here.
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
  const previousConnectTarget = useRef(connectTarget);
  useEffect(() => {
    if (previousConnectTarget.current === connectTarget) return;
    previousConnectTarget.current = connectTarget;
    cancelLivenessCheck();
    setSetupReady(false);
    setSetupFp(null);
    setSetupPinErr("");
    setSetupPinnedKey("");
    setupPinningRef.current = false;
    setSetupPinning(false);
    durableHostKeyProbeId.current += 1;
    setDurableHostKey(null);
    setDurableHostKeyChecking(false);
    setInstallState("idle");
  }, [connectTarget, cancelLivenessCheck]);
  // The setup (install) path doesn't require the app to already exist — it installs it. For manual +
  // reconnect, the host app must be installed AND compatible before Next.
  const requiresHostApp = w.index === S.CONNECT && !isSetup;
  const hostAppReady =
    !requiresHostApp ||
    (!!hostApp &&
      hostApp.target === connectTarget &&
      hostApp.installed &&
      hostApp.compatible);
  const requiresHostPerms = w.index === S.CONNECT && !isSetup;
  const hostPermReady =
    !requiresHostPerms ||
    (!!hostPerms &&
      hostPerms.target === connectTarget &&
      hostPerms.alive &&
      hostPerms.ax &&
      hostPerms.sr);
  const hostAppLiveFalse =
    requiresHostPerms &&
    !!hostApp &&
    hostApp.target === connectTarget &&
    hostApp.installed === true &&
    hostApp.compatible === true &&
    !!hostPerms &&
    hostPerms.target === connectTarget &&
    hostPerms.alive === false;

  // Once reachable on a non-setup path, probe the host app exactly once per (target, reachable) edge.
  useEffect(() => {
    if (requiresHostApp && reachReady && connectTarget) {
      void checkHostApp(connectTarget);
    } else if (!requiresHostApp || !reachReady) {
      // Leaving the gate (path change / no longer reachable) clears stale host-app state.
      hostAppProbeId.current += 1;
      setHostApp(null);
      setHostAppChecking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiresHostApp, reachReady, connectTarget]);

  // Only safe host states can use a forced bundled host install: missing, same-major below-floor,
  // or compatible-but-not-live. Major mismatches stay blocked to avoid downgrading a newer host.
  const canUpdateHost =
    requiresHostApp &&
    !hostAppChecking &&
    !!hostApp &&
    hostApp.target === connectTarget &&
    hostApp.installed &&
    !hostApp.compatible &&
    hostApp.incompatibleKind === "below_floor";
  const canRepairHost =
    requiresHostApp &&
    reachReady &&
    (manual || startsFromSavedHost || isReconnect || isConnect) &&
    !hostAppChecking &&
    !!hostApp &&
    hostApp.target === connectTarget &&
    (hostApp.installed !== true ||
      (hostApp.installed === true &&
        hostApp.compatible !== true &&
        hostApp.incompatibleKind === "below_floor") ||
      hostAppLiveFalse);
  const hostRepairKind =
    !hostApp || hostApp.installed !== true
      ? "missing"
      : hostApp.compatible !== true
      ? canUpdateHost
        ? "update"
        : "incompatible"
      : "restart";
  const missingRepairNeedsHostKey =
    hostRepairKind === "missing" &&
    (manual || startsFromSavedHost || isReconnect || isConnect || !!savedHost);
  const missingRepairPeer: Peer | null = connectTarget
    ? {
        name: connectTarget,
        addrs: [connectTarget],
        target: connectTarget,
        source: "ssh",
        sources: ["ssh"],
        fp: null,
        status: "setup",
      }
    : null;

  useEffect(() => {
    if (!canRepairHost || !missingRepairNeedsHostKey || !connectTarget) {
      durableHostKeyProbeId.current += 1;
      setDurableHostKey(null);
      setDurableHostKeyChecking(false);
      return;
    }

    const probeId = ++durableHostKeyProbeId.current;
    setDurableHostKeyChecking(true);
    void window.remotepair
      .hasDurableHostKey(connectTarget)
      .then((r) => {
        if (durableHostKeyProbeId.current !== probeId) return;
        setDurableHostKey({
          target: connectTarget,
          present: !!r.ok && !!r.present,
          err: r.err || "",
        });
      })
      .catch((e) => {
        if (durableHostKeyProbeId.current !== probeId) return;
        setDurableHostKey({ target: connectTarget, present: false, err: String(e) });
      })
      .finally(() => {
        if (durableHostKeyProbeId.current === probeId) setDurableHostKeyChecking(false);
      });
  }, [canRepairHost, missingRepairNeedsHostKey, connectTarget]);

  const handleHostRepairDone = useCallback(() => {
    if (!connectTarget) return;
    setInstallState("idle");
    setHostApp(null);
    setHostPerms(null);
    setHostPermChecking(false);
    void checkHostApp(connectTarget);
  }, [checkHostApp, connectTarget]);

  // Non-setup connect/reconnect must prove the Host is currently grant-bearing too. SSH and app
  // presence alone are not enough: hostPermissions must be live and report AX + SR granted.
  useEffect(() => {
    if (!requiresHostPerms || !reachReady || !hostAppReady || !connectTarget) {
      setHostPerms(null);
      setHostPermChecking(false);
      return;
    }

    let alive = true;
    const poll = async () => {
      setHostPermChecking(true);
      try {
        const r = await window.remotepair.hostPermissions({ host: connectTarget });
        if (alive) setHostPerms({ target: connectTarget, ...r });
      } catch (e) {
        if (alive) {
          setHostPerms({
            target: connectTarget,
            alive: false,
            ax: false,
            sr: false,
            fda: false,
            err: String(e),
          });
        }
      } finally {
        if (alive) setHostPermChecking(false);
      }
    };

    void poll();
    const id = window.setInterval(poll, 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [requiresHostPerms, reachReady, hostAppReady, connectTarget]);

  const connectReady = reachReady && hostAppReady && hostPermReady;
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
    setupPinning ||
    cliGateActive || // wait for the background xpair CLI install on CLI-dependent steps.
    w.index === S.DISCOVER || // Discover advances by picking a peer, not Next.
    (w.index === S.CONNECT &&
      (isSetup
        ? !setupReady
        : !connectReady || hostAppChecking || (hostPermChecking && !hostPermReady))) ||
    (w.index === S.GRANT && !grantReady) || // wait until host AX + SR are granted
    (w.index === S.ENGINE && !engineReady); // wait until the engine is installed + authed on the host
  // Folder mappings are OPTIONAL — you can attach to a host for screen share / terminal without
  // mapping any folders and add them later from the IDE ("Add Root"), so the Mappings step never
  // blocks Next.

  // Custom Next routing: Mappings → run liveness check before Done; Connect (non-setup) skips the
  // Installing step.
  const setupPinKey = useCallback(
    (target: string, fp: string | null) => `${target}\n${fp ?? ""}`,
    [],
  );
  const pinConfirmedHostKey = useCallback(
    async (target: string, expectedFp: string | null) => {
      if (setupPinningRef.current) return false;
      setupPinningRef.current = true;
      setSetupPinning(true);
      setSetupPinErr("");
      setLive("idle");
      setLiveErr("");
      try {
        const r = await window.remotepair.pinHostKey(target, expectedFp ?? "");
        if (r.ok) {
          setSetupPinnedKey(setupPinKey(target, expectedFp));
          return true;
        }
        setSetupPinnedKey("");
        const err = r.err || "Could not pin this host key. Verify the fingerprint, then retry.";
        setLiveErr(err);
        if (isHostKeyMismatch(err, r.state)) {
          setLive("rekeyed");
          setSetupPinErr(
            "SSH host key changed. Re-pair this host, or verify the Mac and update known_hosts before retrying.",
          );
        } else {
          setSetupPinErr(err);
        }
        return false;
      } catch (e) {
        const err = String(e);
        setSetupPinnedKey("");
        setSetupPinErr(err);
        setLiveErr(err);
        return false;
      } finally {
        setupPinningRef.current = false;
        setSetupPinning(false);
      }
    },
    [setupPinKey],
  );
  const onNext = async () => {
    if (w.index === S.CONNECT && isSetup) {
      if (await pinConfirmedHostKey(currentTarget, setupFp)) {
        stepRef.current = S.INSTALL;
        w.next();
      }
      return;
    }
    if (w.index === S.CONNECT && !isSetup) {
      // Reconnect path and manual path both skip the Installing + Grant steps → straight to Engine.
      stepRef.current = S.ENGINE;
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
  // both fall back to the fingerprint-confirm setup step.
  const onPrev = () => {
    if (w.index === S.MAPPINGS) {
      // Mappings always follows the Engine step.
      cancelLivenessCheck();
      setLive("idle");
      setLiveErr("");
      stepRef.current = S.ENGINE;
      w.goTo(S.ENGINE, "prev");
      return;
    }
    if (w.index === S.ENGINE) {
      // Engine follows Grant on the setup path, Connect on the reconnect/manual paths.
      const dest = isSetup && !manual ? S.GRANT : S.CONNECT;
      stepRef.current = dest;
      w.goTo(dest, "prev");
      return;
    }
    if (w.index === S.GRANT || w.index === S.INSTALL) {
      stepRef.current = S.CONNECT;
      w.goTo(S.CONNECT, "prev");
      return;
    }
    w.prev();
  };

  // Mappings runs the final gate before Done, so failed probes keep a retry-oriented label.
  const nextLabel =
    setupPinning
      ? "Pinning…"
      : w.index === S.MAPPINGS && live === "checking"
      ? "Checking…"
      : w.index === S.MAPPINGS &&
        (live === "offline" ||
          live === "rekeyed" ||
          live === "setup" ||
          live === "host-app" ||
          live === "permissions")
      ? "Re-check"
      : w.index === S.MAPPINGS && mappings.length === 0
      ? "Skip for now"
      : "Next";

  const durableEntryVerified =
    missingRepairNeedsHostKey &&
    durableHostKey?.target === connectTarget &&
    durableHostKey.present;
  const repairHostKeyPinned =
    !missingRepairNeedsHostKey ||
    durableEntryVerified ||
    setupPinnedKey === setupPinKey(connectTarget, setupFp);

  const hostRepairPanel = canRepairHost ? (
    <>
      {missingRepairNeedsHostKey && !durableEntryVerified && missingRepairPeer && (
        <div className="mt-4">
          <StepSetupPassword
            peer={missingRepairPeer}
            onReady={setSetupReady}
            onFingerprint={setSetupFp}
            error={setupPinErr}
          />
        </div>
      )}
      {missingRepairNeedsHostKey && setupReady && !repairHostKeyPinned && (
        <div className="mx-auto mt-4 max-w-sm rounded-xl border border-border bg-muted/25 p-3.5 text-xs text-muted-foreground">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
              <p className="font-semibold text-foreground">Trust this host key before installing.</p>
              <p className="mt-1 leading-snug">
                Xpair will pin the confirmed fingerprint for {connectTarget}.
              </p>
              {durableHostKey?.target === connectTarget && durableHostKey.err ? (
                <p className="mt-1 leading-snug text-destructive">{durableHostKey.err}</p>
              ) : null}
              <Button
                type="button"
                size="sm"
                className="mt-2 h-8 gap-1.5"
                disabled={setupPinning || durableHostKeyChecking}
                onClick={() => void pinConfirmedHostKey(connectTarget, setupFp)}
              >
                {setupPinning || durableHostKeyChecking ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {setupPinning
                  ? "Pinning…"
                  : durableHostKeyChecking
                  ? "Checking…"
                  : "Trust host key"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {repairHostKeyPinned && (
        <div className="mt-4">
          <StepInstalling
            isUpdate={hostRepairKind === "update"}
            forceInstall
            repairKind={hostRepairKind}
            host={connectTarget}
            hostName={manual ? connectTarget : peer?.name || connectTarget}
            currentVersion={hostApp?.version || ""}
            requiredVersion={hostRepairKind === "update" ? MIN_COMPATIBLE_HOST : ""}
            state={installState}
            setState={setInstallState}
            onDone={handleHostRepairDone}
            onFail={() => setInstallState("idle")}
          />
        </div>
      )}
    </>
  ) : null;

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
            {canRepairHost
              ? "Repair XpairHost below to continue."
              : !hostApp.installed
              ? "Host has no Xpair host app — install it on the host."
              : hostApp.err || "Host version is incompatible with this client."}
          </p>
        ) : requiresHostPerms && reachReady && hostAppReady && !hostPermReady ? (
          <p className="truncate text-center text-xs text-destructive">
            {canRepairHost
              ? "Repair XpairHost below to continue."
              : hostPermChecking
              ? "Checking host permissions…"
              : hostPerms?.err ||
                "Grant Accessibility and Screen Recording on the host to continue."}
          </p>
        ) : w.index === S.ENGINE && !engineReady ? (
          <p className="truncate text-center text-xs text-muted-foreground">
            Set up {engine} on the host to continue.
          </p>
        ) : w.index === S.MAPPINGS &&
          (live === "offline" ||
            live === "rekeyed" ||
            live === "setup" ||
            live === "host-app" ||
            live === "permissions") ? (
          <p className="text-center text-xs leading-snug text-destructive">
            {live === "rekeyed"
              ? "Host identity changed — re-pair."
              : liveErr ||
                (live === "offline"
                  ? "Host unreachable — re-discover."
                  : live === "setup"
                  ? "Host setup has not finished."
                  : live === "host-app"
                  ? "Host app check failed."
                  : "Host permissions are not ready.")}
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              cancelLivenessCheck();
              setLive("idle");
              setLiveErr("");
              stepRef.current = S.DISCOVER;
              w.goTo(S.DISCOVER, "prev");
            }}
          >
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
          (manual || isConnect || !peer ? (
            <>
              <StepConnect
                host={host}
                setHost={setHost}
                state={connState}
                setState={setConnState}
                cliBlocked={cliGateActive}
                autoCheck={initialStep === S.CONNECT}
                onBackToDiscovery={() => {
                  stepRef.current = S.DISCOVER;
                  w.goTo(S.DISCOVER, "prev");
                }}
              />
              {hostRepairPanel}
            </>
          ) : isReconnect ? (
            <>
              <StepReconnect peer={peer} onReady={setReconnectReady} />
              {hostRepairPanel}
            </>
          ) : (
            <StepSetupPassword
              peer={peer}
              onReady={setSetupReady}
              onFingerprint={setSetupFp}
              error={setupPinErr}
            />
          ))}
        {w.index === S.INSTALL && peer && (
          <StepInstalling
            peer={peer}
            state={installState}
            setState={setInstallState}
            onDone={() => {
              setGrantReady(false);
              stepRef.current = S.GRANT;
              w.goTo(S.GRANT, "next");
            }}
            onFail={() => {
              stepRef.current = S.CONNECT;
              w.goTo(S.CONNECT, "prev");
            }}
          />
        )}
        {w.index === S.GRANT && peer && (
          <StepGrantPermissions peer={peer} user={account} onReady={setGrantReady} />
        )}
        {w.index === S.ENGINE && (
          <StepEngine
            engine={engine}
            setEngine={setEngine}
            lockConfigured={lockConfiguredEngine}
            onReady={setEngineReady}
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
