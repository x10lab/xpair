import { useEffect, useState } from "react";
import { BarChart3, Bug } from "lucide-react";

// First-run consent UI — two INDEPENDENT opt-in checkboxes (product analytics + crash reports),
// BOTH default OFF. Rendered on the FIRST onboarding screen (StepWelcome) so consent is decided
// BEFORE setup completes, and again on StepDone as a re-toggle summary. With both OFF, no telemetry
// or crash report ever leaves the machine. Persists via the host bridge to the SAME UserDefaults
// keys the rest of the host uses (RPTelemetryConsent / RPCrashReportConsent) — one source of truth.

type Variant = "prompt" | "summary";

export function ConsentControls({
  variant,
  showHeader = true,
}: {
  variant: Variant;
  // When false, the card omits its own eyebrow + description (the host step provides the heading).
  showHeader?: boolean;
}) {
  const [telemetryOn, setTelemetryOn] = useState(false);
  const [crashOn, setCrashOn] = useState(false);

  // Load previously-saved consent so revisiting any surface shows the real state (re-toggleable).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const c = await window.remotepair.getConsent();
        if (active && c) {
          setTelemetryOn(!!c.telemetry);
          setCrashOn(!!c.crash);
        }
      } catch {
        /* default OFF on any error */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Persist on every toggle (both flags written together; bridge writes UserDefaults).
  const persist = (t: boolean, c: boolean) => {
    setTelemetryOn(t);
    setCrashOn(c);
    try {
      void window.remotepair.setConsent({ telemetry: t, crash: c });
    } catch {
      /* best effort — UI state still reflects the choice */
    }
  };

  const heading = variant === "prompt" ? "Before we start" : "Help improve RemotePair (optional)";

  return (
    <div className="w-full max-w-sm rounded-xl border border-border bg-muted/30 p-4 text-left">
      {showHeader && (
        <>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {heading}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Off by default. Anonymous only — never your files, paths, repo names, or IP. Change
            anytime in Settings.
          </p>
        </>
      )}

      <ConsentRow
        icon={<BarChart3 className="h-4 w-4" />}
        title="Share anonymous usage analytics"
        desc="Onboarding & connection funnel, so we can fix the rough edges."
        checked={telemetryOn}
        onChange={(v) => persist(v, crashOn)}
      />
      <ConsentRow
        icon={<Bug className="h-4 w-4" />}
        title="Send anonymized crash reports"
        desc="Scrubbed crash diagnostics (no personal data) to catch bugs."
        checked={crashOn}
        onChange={(v) => persist(telemetryOn, v)}
      />
    </div>
  );
}

function ConsentRow({
  icon,
  title,
  desc,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="mt-3 flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{desc}</span>
      </span>
    </label>
  );
}
