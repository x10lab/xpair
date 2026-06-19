import { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Key,
  Loader2,
  Plus,
  Send,
  Terminal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ConnState =
  | "idle"
  | "connecting"
  | "connected_installed"
  | "connected_not_installed"
  | "disconnected"
  | "installing"
  | "install_done";

type Mode = "existing" | "new";
type SetupStep = "generate" | "copy" | "alias";
type StepStatus = "pending" | "running" | "done";

type Props = {
  alias: string;
  setAlias: (s: string) => void;
  state: ConnState;
  setState: (s: ConnState) => void;
};

export function StepConnect({ alias, setAlias, state, setState }: Props) {
  const [mode, setMode] = useState<Mode>("existing");

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Connect to your host
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Use an existing SSH alias, or let us set up a new key for you.
      </p>

      <div className="mt-5 inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
        {(["existing", "new"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={
              "rounded-md px-3 py-1 text-xs font-medium transition-colors " +
              (mode === m
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {m === "existing" ? "I have a host" : "Set up a new key"}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {mode === "existing" ? (
          <ExistingPanel
            alias={alias}
            setAlias={setAlias}
            state={state}
            setState={setState}
          />
        ) : (
          <NewKeyPanel
            alias={alias}
            setAlias={setAlias}
            state={state}
            setState={setState}
          />
        )}
      </div>

      <div className="mt-5">
        <StatusPanel state={state} alias={alias} setState={setState} />
      </div>
    </div>
  );
}

/* ------------------------- Existing alias ------------------------- */

function ExistingPanel({ alias, setAlias, state, setState }: Props) {
  const [showGuide, setShowGuide] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state !== "connecting") return;
    const t = setTimeout(() => {
      if (!alias.trim() || alias.trim().length < 3) setState("disconnected");
      else
        setState(
          alias.toLowerCase().includes("installed")
            ? "connected_installed"
            : "connected_not_installed",
        );
    }, 1300);
    return () => clearTimeout(t);
  }, [state, alias, setState]);

  const keygen = `ssh-keygen -t ed25519 -C "you@mac"`;

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Terminal className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="gh-mac-m1"
            className="pl-9 font-mono text-sm"
            disabled={state === "connecting" || state === "installing"}
          />
        </div>
        <Button
          size="sm"
          onClick={() => setState("connecting")}
          disabled={state === "connecting" || state === "installing" || !alias.trim()}
        >
          {state === "connecting" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            "Connect"
          )}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        We'll run <span className="font-mono">ssh {alias || "<alias>"}</span> to verify.
      </p>

      <button
        type="button"
        onClick={() => setShowGuide((s) => !s)}
        className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          className={"h-3 w-3 transition-transform " + (showGuide ? "rotate-180" : "")}
        />
        Manual setup reference
      </button>

      {showGuide && (
        <div className="mt-2 space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <CmdLine
            cmd={keygen}
            onCopy={() => {
              navigator.clipboard?.writeText(keygen);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            copied={copied}
          />
          <a
            href="https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Full SSH key guide
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
    </div>
  );
}

/* ------------------------- Guided new key ------------------------- */

function NewKeyPanel({
  alias,
  setAlias,
  state,
  setState,
}: Props) {
  const [keyName, setKeyName] = useState("id_ed25519_xpair");
  const [hostAddr, setHostAddr] = useState("");
  const [pubKey, setPubKey] = useState("");
  const [steps, setSteps] = useState<Record<SetupStep, StepStatus>>({
    generate: "pending",
    copy: "pending",
    alias: "pending",
  });

  const run = (
    s: SetupStep,
    ms: number,
    after: () => void,
  ) => {
    setSteps((p) => ({ ...p, [s]: "running" }));
    setTimeout(() => {
      setSteps((p) => ({ ...p, [s]: "done" }));
      after();
    }, ms);
  };

  const allDone = steps.generate === "done" && steps.copy === "done" && steps.alias === "done";

  useEffect(() => {
    if (state !== "connecting") return;
    const t = setTimeout(() => {
      if (!alias.trim()) setState("disconnected");
      else setState("connected_not_installed");
    }, 1200);
    return () => clearTimeout(t);
  }, [state, alias, setState]);

  return (
    <div className="space-y-2">
      {/* 1. Generate */}
      <SetupRow
        index={1}
        icon={<Key className="h-3.5 w-3.5" />}
        status={steps.generate}
        title="Generate a key in ~/.ssh"
      >
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
              ~/.ssh/
            </span>
            <Input
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              className="pl-12 font-mono text-xs"
              disabled={steps.generate !== "pending"}
            />
          </div>
          <Button
            size="sm"
            variant={steps.generate === "done" ? "ghost" : "default"}
            disabled={steps.generate !== "pending"}
            onClick={() =>
              run("generate", 1100, () =>
                setPubKey(
                  `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI…${keyName.slice(0, 6)} you@mac`,
                ),
              )
            }
          >
            {steps.generate === "running" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : steps.generate === "done" ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              "Generate"
            )}
          </Button>
        </div>
        {steps.generate === "done" && pubKey && (
          <div className="mt-2 truncate rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
            {pubKey}
          </div>
        )}
      </SetupRow>

      {/* 2. Send public key to host */}
      <SetupRow
        index={2}
        icon={<Send className="h-3.5 w-3.5" />}
        status={steps.copy}
        title="Copy public key to host"
        disabled={steps.generate !== "done"}
      >
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Terminal className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={hostAddr}
              onChange={(e) => setHostAddr(e.target.value)}
              placeholder="user@192.168.1.42"
              className="pl-9 font-mono text-xs"
              disabled={steps.copy !== "pending" || steps.generate !== "done"}
            />
          </div>
          <Button
            size="sm"
            variant={steps.copy === "done" ? "ghost" : "default"}
            disabled={
              steps.copy !== "pending" ||
              steps.generate !== "done" ||
              !hostAddr.trim()
            }
            onClick={() => run("copy", 1400, () => {})}
          >
            {steps.copy === "running" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : steps.copy === "done" ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              "Send"
            )}
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          One-time host password prompt may appear (<span className="font-mono">ssh-copy-id</span>).
        </p>
      </SetupRow>

      {/* 3. Save alias to ssh config */}
      <SetupRow
        index={3}
        icon={<Plus className="h-3.5 w-3.5" />}
        status={steps.alias}
        title="Save alias to ~/.ssh/config"
        disabled={steps.copy !== "done"}
      >
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
              Host
            </span>
            <Input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="gh-mac-m1"
              className="pl-12 font-mono text-xs"
              disabled={steps.alias !== "pending" || steps.copy !== "done"}
            />
          </div>
          <Button
            size="sm"
            variant={steps.alias === "done" ? "ghost" : "default"}
            disabled={
              steps.alias !== "pending" ||
              steps.copy !== "done" ||
              !alias.trim()
            }
            onClick={() => run("alias", 700, () => {})}
          >
            {steps.alias === "running" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : steps.alias === "done" ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </SetupRow>

      {/* 4. Test connection */}
      <div className="pt-2">
        <Button
          size="sm"
          className="w-full"
          disabled={!allDone || state === "connecting" || state === "installing"}
          onClick={() => setState("connecting")}
        >
          {state === "connecting" ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Testing ssh {alias}…
            </>
          ) : (
            <>Test connection</>
          )}
        </Button>
      </div>
    </div>
  );
}

function SetupRow({
  index,
  icon,
  title,
  status,
  disabled,
  children,
}: {
  index: number;
  icon: React.ReactNode;
  title: string;
  status: StepStatus;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const done = status === "done";
  return (
    <div
      className={
        "rounded-xl border p-3 transition-colors " +
        (done
          ? "border-primary/30 bg-primary/5"
          : disabled
          ? "border-border bg-muted/20 opacity-60"
          : "border-border bg-card")
      }
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className={
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold " +
            (done
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground")
          }
        >
          {done ? <Check className="h-3 w-3" /> : index}
        </span>
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {icon}
          {title}
        </span>
      </div>
      <div className="pl-7">{children}</div>
    </div>
  );
}

/* ------------------------- Shared ------------------------- */

function CmdLine({
  cmd,
  onCopy,
  copied,
}: {
  cmd: string;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
      <span className="min-w-0 flex-1 truncate">{cmd}</span>
      <button
        onClick={onCopy}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label="Copy"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function StatusPanel({
  state,
  alias,
  setState,
}: {
  state: ConnState;
  alias: string;
  setState: (s: ConnState) => void;
}) {
  const [installPct, setInstallPct] = useState(0);

  useEffect(() => {
    if (state !== "installing") {
      if (state !== "install_done") setInstallPct(0);
      return;
    }
    if (installPct >= 100) {
      const t = setTimeout(() => setState("install_done"), 400);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setInstallPct((p) => Math.min(100, p + 2)), 80);
    return () => clearTimeout(t);
  }, [state, installPct, setState]);

  if (state === "idle" || state === "connecting") return null;

  if (state === "disconnected")
    return (
      <Panel tone="danger" icon={<X className="h-3.5 w-3.5" />} title="Couldn't connect">
        <p>
          <span className="font-mono">ssh {alias}</span> failed. Check your alias,
          network, and that the host Mac is awake.
        </p>
      </Panel>
    );

  if (state === "connected_installed")
    return (
      <Panel tone="ok" icon={<Check className="h-3.5 w-3.5" />} title="Connected · helper detected">
        <p>XpairHost is already installed on {alias}.</p>
      </Panel>
    );

  if (state === "connected_not_installed")
    return (
      <Panel
        tone="warn"
        icon={<AlertCircle className="h-3.5 w-3.5" />}
        title="Connected · helper not installed"
      >
        <p>We reached {alias} but couldn't find XpairHost.</p>
        <Button size="sm" className="mt-3" onClick={() => setState("installing")}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Install on host
        </Button>
      </Panel>
    );

  if (state === "installing")
    return (
      <Panel
        tone="info"
        icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
        title="Installing on host…"
      >
        <p>
          Go to the host Mac's screen and approve permission prompts
          (Accessibility, Screen Recording, Full Disk Access) as they appear.
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border/70">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${installPct}%` }}
          />
        </div>
      </Panel>
    );

  return (
    <Panel tone="ok" icon={<Check className="h-3.5 w-3.5" />} title="Installed and ready">
      <p>XpairHost is running on {alias}.</p>
    </Panel>
  );
}

function Panel({
  tone,
  icon,
  title,
  children,
}: {
  tone: "ok" | "warn" | "danger" | "info";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const toneClass = {
    ok: "border-primary/30 bg-primary/5",
    warn: "border-amber-500/30 bg-amber-500/5",
    danger: "border-destructive/30 bg-destructive/5",
    info: "border-border bg-muted/40",
  }[tone];
  const iconClass = {
    ok: "bg-primary text-primary-foreground",
    warn: "bg-amber-500 text-white",
    danger: "bg-destructive text-destructive-foreground",
    info: "bg-muted-foreground/20 text-foreground",
  }[tone];
  return (
    <div className={"rounded-xl border p-4 " + toneClass}>
      <div className="flex items-center gap-2">
        <span className={"flex h-5 w-5 items-center justify-center rounded-full " + iconClass}>
          {icon}
        </span>
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      <div className="mt-2 pl-7 text-xs text-muted-foreground">{children}</div>
    </div>
  );
}
