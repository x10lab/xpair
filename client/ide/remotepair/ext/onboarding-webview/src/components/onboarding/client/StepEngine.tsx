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
  | { installed: boolean; authed: boolean; version: string; err: string }
  | null;

const ENGINES: { id: EngineId; label: string; blurb: string }[] = [
  { id: "claude", label: "Claude Code", blurb: "Anthropic — the default." },
  { id: "codex", label: "Codex", blurb: "OpenAI — GPT models." },
  { id: "opencode", label: "opencode", blurb: "Open-source, multi-provider." },
];

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
  const [status, setStatus] = useState<EngineStatus>(null);
  const [probing, setProbing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [authing, setAuthing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [actionErr, setActionErr] = useState("");

  const probe = useCallback(async (e: EngineId) => {
    setProbing(true);
    setActionErr("");
    try {
      const r = await window.remotepair.hostEngineStatus(e);
      setStatus(r);
      onReady(r.installed && r.authed);
    } catch (err) {
      setStatus({ installed: false, authed: false, version: "", err: String(err) });
      onReady(false);
    } finally {
      setProbing(false);
    }
  }, [onReady]);

  // On (re)selecting an engine: persist it, clear the key field, and re-probe the host.
  useEffect(() => {
    let alive = true;
    onReady(false);
    setStatus(null);
    setApiKey("");
    (async () => {
      try {
        await window.remotepair.setEngine(engine);
      } catch {
        /* persist failure shouldn't block the host probe */
      }
      if (alive) await probe(engine);
    })();
    return () => {
      alive = false;
    };
  }, [engine, probe, onReady]);

  const onInstall = useCallback(async () => {
    setInstalling(true);
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
      setInstalling(false);
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

  const ready = !!status && status.installed && status.authed;
  const busy = probing || installing || authing;

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">Choose your engine</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        The agent that runs on the host. It must be installed and signed in there before you can
        pair — we'll check and set it up.
      </p>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {ENGINES.map((e) => {
          const selected = engine === e.id;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => setEngine(e.id)}
              className={
                "flex flex-col rounded-lg border px-3 py-2.5 text-left transition-colors " +
                (selected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-muted/30 hover:bg-muted/50")
              }
            >
              <span className="text-sm font-semibold text-foreground">{e.label}</span>
              <span className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                {e.blurb}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 min-h-6 text-xs">
        {probing && (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking the host for {engine}…
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
