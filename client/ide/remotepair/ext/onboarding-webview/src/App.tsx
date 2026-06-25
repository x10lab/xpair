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
      // WHY incompatible — only "below_floor" (same major, too old) is safe to force-update.
      // "major_mismatch" (different/newer major) must stay a blocking error (force = downgrade).
      incompatibleKind: "below_floor" | "major_mismatch" | "";
      err: string;
    }
  | null;
type HostPermState =
  | { target: string; alive: boolean; ax: boolean; sr: boolean; fda: boolean; err: string }
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
  const [installState, setInstallState] = useState<InstallState>("idle");
  // Install step mode. "install" = fresh setup-path install (peer-driven). "update" = the host app is
  // already installed but below MIN_COMPATIBLE_HOST; we reuse StepInstalling with force:true to push
  // the client-bundled host over it. Applies to manual/connect/reconnect (non-setup) paths.
  const [installMode, setInstallMode] = useState<"install" | "update">("install");
  // Where the update flow was launched from, so onDone routes back to the right gate and re-checks
  // there. "connect" = the Connect-step host-app gate (non-setup); "final" = the Mappings final
  // liveness gate (either path, incl. setup peers whose first install hit an existing host).
  const [updateOrigin, setUpdateOrigin] = useState<"connect" | "final">("connect");
  // Explicit "user backed out of the update" flag (Finding A). Set on Back/cancel from the update
  // step; SUPPRESSES the Connect-step auto-route even when a fresh host-app probe STILL reports the
  // host below-floor. Clearing the cached probe alone is not enough: a reachable, still-incompatible
  // host re-reports below_floor on the Connect re-probe, which would immediately re-route the user
  // back into the update they just abandoned — trapping them. With this flag set, the gate stays
  // closed (warning still visible) but the auto-route holds, so the user can recover or pick another
  // host. Reset when the user re-initiates the update or selects/targets a different host / re-discovers.
  const [updateDismissed, setUpdateDismissed] = useState(false);
  // Host-version context for the update warning copy (current host version vs the client version it
  // must match), captured from the incompatible host-app probe that triggered the update.
  const [updateCtx, setUpdateCtx] = useState<{ host: string; current: string; required: string }>({
    host: "",
    current: "",
    required: "",
  });
  const [clientVer, setClientVer] = useState("");
  // Host TCC grant readiness, lifted from the Grant step so Next stays gated until AX + SR are on.
  const [grantReady, setGrantReady] = useState(false);
  // Reconnect reachability, lifted from the Reconnect step so Next gates until the host answers.
  const [reconnectReady, setReconnectReady] = useState(false);
  const [live, setLive] = useState<LiveState>("idle");
  const [liveErr, setLiveErr] = useState("");

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

  // Client version (for the host-update warning's "needs version X or newer" copy).
  useEffect(() => {
    void window.remotepair
      .clientVersion()
      .then((v) => setClientVer(v || ""))
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
      setSetupReady(false);
      setConnState("idle");
      hostAppProbeId.current += 1;
      setHostApp(null);
      setHostAppChecking(false);
      setHostPerms(null);
      setInstallState("idle");
      setInstallMode("install");
      // New target → a prior back-out no longer applies; let the new host's probe drive routing.
      setUpdateDismissed(false);
      setReconnectReady(false);
      setLive("idle");
      setLiveErr("");
      w.goTo(S.CONNECT, "next");
    },
    [cliReady, w],
  );

  const onManual = useCallback(() => {
    setManual(true);
    setPeer(null);
    setSetupReady(false);
    hostAppProbeId.current += 1;
    setHostApp(null);
    setHostAppChecking(false);
    setHostPerms(null);
    setInstallState("idle");
    setInstallMode("install");
    // New manual target → a prior back-out no longer applies (Finding A).
    setUpdateDismissed(false);
    setLive("idle");
    setLiveErr("");
    w.goTo(S.CONNECT, "next");
  }, [w]);

  // Route the wizard into StepInstalling in UPDATE mode: the host app is installed but below
  // MIN_COMPATIBLE_HOST. Reused by the Connect-step host-app gate and the final liveness gate.
  const routeToHostUpdate = useCallback(
    (target: string, hostVersion: string, origin: "connect" | "final") => {
      setInstallMode("update");
      setUpdateOrigin(origin);
      // User is (re-)initiating the update → clear any prior back-out so the post-update re-checks
      // and the Connect-step auto-route behave normally again (Finding A).
      setUpdateDismissed(false);
      setUpdateCtx({ host: target, current: hostVersion, required: clientVer });
      setInstallState("idle");
      // The final-gate path already flipped live="checking" (runLivenessCheck). Clear it so that when
      // the update finishes and returns, Next isn't stuck disabled by `live === "checking"`.
      setLive("idle");
      setLiveErr("");
      w.goTo(S.INSTALL, "next");
    },
    [clientVer, w],
  );

  // After a successful `install-host --force`, the host's LaunchAgent is kickstarted but the OLD
  // ~/.xpair/host/logs/status.json lingers until the host app rewrites it on its next tick. An
  // immediate hostAppStatus read can therefore return the STALE pre-update version and look "still
  // incompatible", bouncing the user back to the update screen even though the reinstall succeeded
  // (Finding D). Poll until the reported version moves off `staleVersion` (or becomes compatible, or
  // the app stops reporting a version), giving the host a few seconds to come up before re-checking.
  const waitForFreshHostStatus = useCallback(async (target: string, staleVersion: string) => {
    for (let i = 0; i < 8; i++) {
      try {
        const app = await window.remotepair.hostAppStatus(target);
        // Fresh status: the version changed off the stale one, or it's now compatible, or it reset
        // to unknown (status.json not yet re-stamped, treated as compatible downstream).
        if (app.compatible || !app.version || app.version !== staleVersion) {
          setHostApp({ target, ...app });
          return;
        }
      } catch {
        /* transient SSH hiccup while the host restarts — keep polling */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    // Timed out waiting for a fresh stamp — fall through; the subsequent liveness check surfaces the
    // current (possibly still-stale) state to the user as a re-checkable error rather than hanging.
  }, []);

  // Final gate before Done: the earlier steps keep the user moving, but Done only opens after fresh
  // setup, host-app, permission, and SSH liveness probes all pass.
  const runLivenessCheck = useCallback(async () => {
    const target = manual ? host.trim() : peer?.target || peer?.addrs?.[0] || peer?.name || "";
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
      setHostApp({ target, ...app });
      if (app.installed && !app.compatible && app.incompatibleKind === "below_floor") {
        // Installed-but-too-old (same major, below floor) at the final gate → route to the in-UI
        // update flow (force reinstall the bundled host) rather than dead-ending. Same routing as the
        // Connect-step gate. A different/NEWER major is NOT routed here (force = downgrade); it falls
        // through to the blocking host-app error below.
        routeToHostUpdate(target, app.version, "final");
        return;
      }
      if (app.installed && !app.compatible) {
        // Different/NEWER major (major_mismatch) — force-reinstalling the bundled host would DOWNGRADE
        // it, so block with the explicit incompatibility message instead of forcing an update.
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
      setLiveErr(`Host app check failed: ${String(e)}`);
      setLive("host-app");
      return;
    }

    try {
      const perms = await window.remotepair.hostPermissions({ host: target });
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
      setGrantReady(false);
      setLiveErr(`Permission check failed: ${String(e)}`);
      setLive("permissions");
      return;
    }

    try {
      const r = await window.remotepair.sshReachable(target);
      if (r.reachable) {
        setLive("reachable");
        w.goTo(S.DONE, "next");
        return;
      }
      // A host-key mismatch surfaces as an ssh failure mentioning the host key; treat that as a
      // re-key (TOFU mismatch) so the user re-pairs instead of silently failing.
      setLiveErr(r.err || "Host did not respond.");
      setLive(/host key|REMOTE HOST IDENTIFICATION/i.test(r.err || "") ? "rekeyed" : "offline");
    } catch (e) {
      setLiveErr(`Liveness check failed: ${String(e)}`);
      setLive("offline");
    }
  }, [manual, host, peer, isSetup, installState, w, routeToHostUpdate]);

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

  // Host-app probe came back installed-but-incompatible on the Connect step (non-setup paths) → the
  // host is below MIN_COMPATIBLE_HOST. Instead of dead-ending on a "update the host" message, route
  // the wizard into StepInstalling in update mode (force-reinstall the bundled host). The not-installed
  // sub-case keeps its existing behavior (manual/connect/reconnect have no fresh-install path, so it
  // stays a blocking message via centerSlot). compatible hosts just open the gate (no routing).
  useEffect(() => {
    if (
      requiresHostApp &&
      !hostAppChecking &&
      // The user explicitly backed out of the update for this host (Finding A). A reachable but still
      // below-floor host re-reports below_floor on every Connect re-probe, so without this guard the
      // auto-route would immediately bounce them back into the update they just abandoned. Hold the
      // route; the gate stays closed (warning shown via centerSlot) so they can recover / pick another
      // host. The flag is reset when they re-initiate the update or target a different host.
      !updateDismissed &&
      hostApp &&
      hostApp.target === connectTarget &&
      hostApp.installed &&
      !hostApp.compatible &&
      // Only the same-major-but-below-floor case is safe to force-update; a different/NEWER major
      // (major_mismatch) would be a DOWNGRADE, so it stays a blocking error (handled in centerSlot).
      hostApp.incompatibleKind === "below_floor"
    ) {
      routeToHostUpdate(connectTarget, hostApp.version, "connect");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiresHostApp, hostAppChecking, hostApp, connectTarget, updateDismissed]);

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
  // both fall back to the fingerprint-confirm setup step.
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
    if (w.index === S.INSTALL && installMode === "update") {
      // Header Back from the update step without a successful install. Mirror the update onFail
      // recovery: invalidate the stale incompatible probe (Finding B) so the auto-route doesn't bounce
      // the user back, and preserve setup-done for the final-gate setup case (Finding C). Route back to
      // wherever the update was launched from.
      setInstallMode("install");
      hostAppProbeId.current += 1;
      setHostApp(null);
      setHostAppChecking(false);
      // Mark the update explicitly dismissed so a still-below-floor Connect re-probe doesn't auto-route
      // the user straight back into it (Finding A). Reset on re-initiate / different host.
      setUpdateDismissed(true);
      if (updateOrigin === "final" && isSetup) {
        setInstallState("done");
      } else {
        setInstallState("idle");
      }
      w.goTo(updateOrigin === "final" ? S.MAPPINGS : S.CONNECT, "prev");
      return;
    }
    if (w.index === S.GRANT || w.index === S.INSTALL) {
      w.goTo(S.CONNECT, "prev");
      return;
    }
    w.prev();
  };

  // Mappings runs the final gate before Done, so failed probes keep a retry-oriented label.
  const nextLabel =
    w.index === S.MAPPINGS && live === "checking"
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
        ) : requiresHostPerms && reachReady && hostAppReady && !hostPermReady ? (
          <p className="truncate text-center text-xs text-destructive">
            {hostPermChecking
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
          (manual || isConnect || !peer ? (
            <StepConnect
              host={host}
              setHost={setHost}
              state={connState}
              setState={setConnState}
              cliBlocked={cliGateActive}
              onBackToDiscovery={() => w.goTo(S.DISCOVER, "prev")}
            />
          ) : isReconnect ? (
            <StepReconnect peer={peer} onReady={setReconnectReady} />
          ) : (
            <StepSetupPassword
              peer={peer}
              onReady={setSetupReady}
            />
          ))}
        {w.index === S.INSTALL && installMode === "update" && (
          <StepInstalling
            isUpdate
            host={updateCtx.host}
            hostName={manual ? updateCtx.host : peer?.name || updateCtx.host}
            currentVersion={updateCtx.current}
            requiredVersion={updateCtx.required}
            state={installState}
            setState={setInstallState}
            onDone={() => {
              // Update finished → RE-CHECK that the host is now installed+compatible before letting
              // the user past. Only a compatible re-check opens the gate; an incompatible one re-routes
              // through update again.
              hostAppProbeId.current += 1;
              setHostApp(null);
              setInstallMode("install");
              if (updateOrigin === "final") {
                // Triggered from the Mappings final gate (incl. setup peers, where the Connect step
                // renders the fingerprint step and runs no host-app probe). The update force-installed
                // the bundled host, so the host IS set up — keep installState "done" so the liveness
                // check's setup guard passes. Return to Mappings and re-run the final liveness check;
                // it performs the host-app re-check itself, so Next continues past the completed update
                // instead of re-entering fresh-install.
                setInstallState("done");
                // Keep Next BLOCKED for the whole freshness-poll window (Finding C). Without this,
                // `live` is "idle" on the Mappings return until runLivenessCheck flips it to "checking"
                // seconds later, so a quick Next click would launch a second liveness check that reads
                // the same stale status.json and bypasses the poll. live === "checking" disables Next
                // globally (WizardShell nextDisabled). runLivenessCheck re-sets it on resolve.
                setLive("checking");
                setLiveErr("");
                w.goTo(S.MAPPINGS, "prev");
                // The forced reinstall just kickstarted the host's LaunchAgent; status.json may still
                // hold the STALE pre-update version for a moment (Finding D). Wait for a fresh/newer
                // version before the liveness re-check so a lingering stale status.json doesn't read
                // "still incompatible" and bounce the user back to update.
                const staleVer = updateCtx.current;
                const updTarget = updateCtx.host;
                void (async () => {
                  await waitForFreshHostStatus(updTarget, staleVer);
                  await runLivenessCheck();
                })();
              } else {
                // Triggered from the Connect-step host-app gate (non-setup). Returning to Connect
                // re-probes the host app itself (requiresHostApp is true there → the Connect effect
                // runs checkHostApp on entry). But install-host --force only KICKSTARTS the host's
                // LaunchAgent; status.json keeps the pre-update below-floor version until the host
                // rewrites it on its next tick. If we navigate back immediately, the Connect re-probe
                // reads that STALE status and the auto-route bounces the just-updated host right back
                // into update (Finding B). So apply the SAME freshness wait as the final gate: poll
                // until status.json refreshes/compatible BEFORE returning to Connect, and keep Next
                // blocked (live === "checking") for the whole window so a quick click can't skip it
                // (Finding C). Once fresh, drop live back to "idle" so Connect's own connectReady gate
                // (re-probe + perms) takes over.
                setInstallState("idle");
                setLive("checking");
                setLiveErr("");
                const staleVer = updateCtx.current;
                const updTarget = updateCtx.host;
                void (async () => {
                  await waitForFreshHostStatus(updTarget, staleVer);
                  setLive("idle");
                  w.goTo(S.CONNECT, "prev");
                })();
              }
            }}
            onFail={() => {
              setInstallMode("install");
              // Backing out of a failed update must NOT bounce the user straight back here. Invalidate
              // the stale incompatible host-app probe so the Connect-step auto-route doesn't re-fire
              // before a fresh probe runs (Finding B). The cleared probe also lets the user pick
              // another host / return to Discovery to recover.
              hostAppProbeId.current += 1;
              setHostApp(null);
              setHostAppChecking(false);
              // Explicit back-out from a failed update: suppress the Connect-step auto-route so a host
              // that is still below-floor doesn't bounce the user right back here (Finding A).
              setUpdateDismissed(true);
              if (updateOrigin === "final" && isSetup) {
                // Setup peer whose already-completed setup (installState "done") routed into the final
                // gate because the existing host was incompatible. The forced update FAILED, but setup
                // itself is still done — keep installState "done" so the Mappings re-check re-probes the
                // host instead of tripping the `isSetup && installState !== "done"` setup guard and
                // trapping the user in the fresh-install loop (Finding C).
                setInstallState("done");
              } else {
                setInstallState("idle");
              }
              w.goTo(updateOrigin === "final" ? S.MAPPINGS : S.CONNECT, "prev");
            }}
          />
        )}
        {w.index === S.INSTALL && installMode === "install" && peer && (
          <StepInstalling
            peer={peer}
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
