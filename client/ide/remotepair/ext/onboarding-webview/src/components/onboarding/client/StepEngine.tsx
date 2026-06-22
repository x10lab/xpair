import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, Download, KeyRound, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EngineId } from "@/global";

type Props = {
  engine: EngineId;
  setEngine: (e: EngineId) => void;
  // Lifted to the wizard so Next stays HARD-GATED until the chosen engine is installed AND
  // authenticated on the host (or block with the reason).
  onReady: (ready: boolean) => void;
};

type EngineStatus =
  { installed: boolean; authed: boolean; version: string; err: string };

type EngineStatuses = Record<EngineId, EngineStatus>;

const ENGINES: { id: EngineId; label: string; blurb: string }[] = [
  { id: "claude", label: "Claude Code", blurb: "Anthropic — the default." },
  { id: "codex", label: "Codex", blurb: "OpenAI — GPT models." },
  { id: "opencode", label: "opencode", blurb: "Open-source, multi-provider." },
];

const isReady = (s: EngineStatus | null | undefined) => !!s && s.installed && s.authed;

const missingText = (s: EngineStatus | null | undefined) => {
  if (!s) return "Not checked";
  if (!s.installed) return "Not installed";
  if (!s.authed) return "Installed, sign-in needed";
  return s.version ? `Ready (${s.version})` : "Ready";
};

/**
 * Engine step: the user picks the agent engine (claude | codex | opencode) and we HARD-GATE on that
 * engine being installed AND authenticated ON THE HOST (it runs there under `xpair launch`). Same
 * philosophy as the CLI / host-app guards: block → resolve action (install / set API key) → re-probe
 * → only pass when the host is actually ready.
 *   !installed         → "Install on host" (brew, non-interactive) → re-probe.
 *   installed, !authed → API key field → setHostEngineAuth (key over SSH stdin pipe) → re-probe.
 * Browser-OAuth engines (codex ChatGPT login, opencode `auth login`) can't be driven over SSH — for
 * those the user signs in on the host's own screen; we only automate the API-key path.
 */
export function StepEngine({ engine, setEngine, onReady }: Props) {
  const [statuses, setStatuses] = useState<EngineStatuses | null>(null);
  const [probing, setProbing] = useState(false);
  const [installing, setInstalling] = useState<EngineId | null>(null);
  const [authing, setAuthing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [actionErr, setActionErr] = useState("");
  const [showOther, setShowOther] = useState(false);

  const probeOne = useCallback(async (e: EngineId): Promise<EngineStatus> => {
    try {
      const r = await window.remotepair.hostEngineStatus(e);
      return r;
    } catch (err) {
      onReady(false);
      return { installed: false, authed: false, version: "", err: String(err) };
    }
  }, [onReady]);

  const persistEngine = useCallback(async (e: EngineId) => {
    try {
      await window.remotepair.setEngine(e);
    } catch {
      /* persist failure shouldn't block the host probe */
    }
  }, []);

  const probe = useCallback(async (preferred: EngineId = engine, allowReadyFallback = false) => {
    setProbing(true);
    setActionErr("");
    onReady(false);
    try {
      const entries = await Promise.all(
        ENGINES.map(async ({ id: e }) => [e, await probeOne(e)] as const),
      );
      const nextStatuses = Object.fromEntries(entries) as EngineStatuses;
      setStatuses(nextStatuses);

      const preferredReady = isReady(nextStatuses[preferred]);
      const currentReady = isReady(nextStatuses[engine]);
      const firstReady = ENGINES.find(({ id }) => isReady(nextStatuses[id]))?.id;
      const nextEngine = preferredReady
        ? preferred
        : allowReadyFallback && currentReady
        ? engine
        : allowReadyFallback && firstReady
        ? firstReady
        : preferred;
      const r = nextStatuses[nextEngine];

      if (nextEngine !== engine) setEngine(nextEngine);
      setApiKey("");
      setShowOther(!isReady(r));
      await persistEngine(nextEngine);
      onReady(r.installed && r.authed);
    } finally {
      setProbing(false);
    }
  }, [engine, onReady, persistEngine, probeOne, setEngine]);

  // Probe every supported engine on the selected host before rendering primary choices.
  useEffect(() => {
    void probe(engine, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseReadyEngine = useCallback(async (e: EngineId) => {
    setEngine(e);
    setApiKey("");
    setActionErr("");
    await persistEngine(e);
    const r = statuses?.[e];
    onReady(!!r && r.installed && r.authed);
  }, [onReady, persistEngine, setEngine, statuses]);

  const chooseOtherEngine = useCallback(async (e: EngineId) => {
    setEngine(e);
    setApiKey("");
    setActionErr("");
    setShowOther(true);
    await persistEngine(e);
    onReady(false);
  }, [onReady, persistEngine, setEngine]);

  const onInstall = useCallback(async () => {
    setInstalling(engine);
    setActionErr("");
    try {
      const r = await window.remotepair.installHostEngine(engine);
      if (!r.ok) {
        setActionErr(r.err || "install failed");
        return;
      }
      await probe(engine);
    } catch (err) {
      setActionErr(String(err));
    } finally {
      setInstalling(null);
    }
  }, [engine, probe]);

  const onSetAuth = useCallback(async () => {
    if (!apiKey.trim()) return;
    setAuthing(true);
    setActionErr("");
    try {
      const r = await window.remotepair.setHostEngineAuth(engine, apiKey.trim());
      setApiKey(""); // drop the key from renderer state immediately.
      if (!r.ok) {
        setActionErr(r.err || "could not set API key");
        return;
      }
      await probe(engine);
    } catch (err) {
      setActionErr(String(err));
    } finally {
      setAuthing(false);
    }
  }, [engine, apiKey, probe]);

  const status = statuses?.[engine] || null;
  const ready = isReady(status);
  const readyEngines = statuses ? ENGINES.filter((e) => isReady(statuses[e.id])) : [];
  const missingEngines = statuses ? ENGINES.filter((e) => !isReady(statuses[e.id])) : [];
  const busy = probing || !!installing || authing;
  const catalogReady = statuses !== null;

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">Choose your engine</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        The agent that runs on the host. We check the selected host first and only show engines
        already installed and signed in there.
      </p>

      {!catalogReady ? (
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking the selected host for supported engines...
        </div>
      ) : (
        <>
          {readyEngines.length > 0 ? (
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {readyEngines.map((e) => {
                const selected = engine === e.id;
                const s = statuses[e.id];
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => void chooseReadyEngine(e.id)}
                    className={
                      "flex flex-col rounded-lg border px-3 py-2.5 text-left transition-colors " +
                      (selected
                        ? "border-primary bg-primary/10"
                        : "border-border bg-muted/30 hover:bg-muted/50")
                    }
                  >
                    <span className="text-sm font-semibold text-foreground">{e.label}</span>
                    <span className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                      {s.version || e.blurb}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
              No installed and signed-in engine was found on the selected host.
            </div>
          )}

          <div className="mt-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => setShowOther((v) => !v)}
            >
              <Download className="h-3.5 w-3.5" />
              Other / install
            </Button>
          </div>

          {(showOther || readyEngines.length === 0) && (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {missingEngines.map((e) => {
                const selected = engine === e.id;
                const s = statuses[e.id];
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => void chooseOtherEngine(e.id)}
                    className={
                      "flex flex-col rounded-lg border px-3 py-2.5 text-left transition-colors " +
                      (selected
                        ? "border-primary bg-primary/10"
                        : "border-border bg-muted/20 hover:bg-muted/40")
                    }
                  >
                    <span className="text-sm font-semibold text-foreground">{e.label}</span>
                    <span className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                      {missingText(s)}
                    </span>
                  </button>
                );
              })}
              {missingEngines.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  All supported engines are already available on this host.
                </p>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-5 min-h-6 text-xs">
        {probing && catalogReady && (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking the selected host for supported engines...
          </span>
        )}

        {!probing && status && ready && (
          <span className="flex items-center gap-2 text-primary">
            <Check className="h-3.5 w-3.5" />
            {engine} is installed{status.version ? ` (${status.version})` : ""} and signed in on the
            host. Continue.
          </span>
        )}

        {/* Not installed → install action. */}
        {!probing && status && !status.installed && (
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {engine} isn't installed on the host yet.
            </span>
            <Button size="sm" className="h-8 w-fit gap-1.5" disabled={busy} onClick={() => void onInstall()}>
              {installing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {installing ? "Installing on host…" : "Install on host"}
            </Button>
          </div>
        )}

        {/* Installed but not authed → API key action. */}
        {!probing && status && status.installed && !status.authed && (
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-destructive">
              <KeyRound className="h-3.5 w-3.5" />
              {engine} is installed but not signed in on the host.
            </span>
            <div className="flex items-stretch gap-2">
              <Input
                type="password"
                value={apiKey}
                onChange={(ev) => setApiKey(ev.target.value)}
                placeholder={engine === "codex" ? "sk-… (OpenAI API key)" : "sk-ant-… (Anthropic API key)"}
                autoComplete="off"
                className="h-8 flex-1 rounded-lg border-border bg-muted/30 font-mono text-sm"
              />
              <Button
                size="sm"
                className="h-8 shrink-0 gap-1.5"
                disabled={busy || !apiKey.trim()}
                onClick={() => void onSetAuth()}
              >
                {authing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {authing ? "Setting…" : "Sign in"}
              </Button>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Sent straight to the host over your encrypted SSH connection — never logged or stored on
              this machine. Prefer a browser login? Sign in to {engine} on the host's own screen, then{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => void probe(engine)}
              >
                re-check
              </button>
              .
            </p>
          </div>
        )}

        {/* Probe / SSH failure (couldn't even reach the host) — offer a retry. */}
        {!probing && status && !status.installed && status.err && /SSH|reach/i.test(status.err) && (
          <button
            type="button"
            onClick={() => void probe(engine)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-muted/40 px-3 py-1.5 font-semibold text-muted-foreground transition-colors hover:bg-muted/60"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Retry
          </button>
        )}

        {actionErr && (
          <div className="mt-2 flex items-start gap-2 text-[11.5px] text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">{actionErr}</span>
          </div>
        )}
      </div>
    </div>
  );
}
