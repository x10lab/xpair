import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2, Lock, ShieldCheck } from "lucide-react";
import type { Peer } from "@/global";

export type PinState = "idle" | "pairing" | "paired" | "failed";

type Props = {
  peer: Peer;
  state: PinState;
  setState: (s: PinState) => void;
};

const PIN_LEN = 6;

/**
 * PIN pairing (host already running → NO account password). The 6-digit code is read off the
 * host's physical screen and submitted via window.remotepair.pair(). SECURITY: the PIN lives only
 * in this component's local state and is passed to the bridge as a CLI arg — it is never logged,
 * never put in the DOM beyond the entry boxes, and never sent to telemetry.
 */
export function StepConnectPin({ peer, state, setState }: Props) {
  const [digits, setDigits] = useState<string[]>(Array(PIN_LEN).fill(""));
  const [fp, setFp] = useState<string | null>(peer.fp ?? null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  // Fetch the host-key fingerprint for the TOFU panel if discovery didn't already provide it.
  useEffect(() => {
    if (fp) return;
    let alive = true;
    void window.remotepair
      .hostKeyFingerprint(peer.addrs[0] || peer.name)
      .then((r) => {
        if (alive && r.fp) setFp(r.fp);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fp, peer]);

  const pin = digits.join("");
  const complete = pin.length === PIN_LEN && digits.every((d) => d !== "");

  // Submit the PAKE when all 6 digits are entered.
  useEffect(() => {
    if (!complete || state !== "idle") return;
    setState("pairing");
    let alive = true;
    void window.remotepair
      .pair({ host: peer.addrs[0] || peer.name, pin, fp })
      .then((r) => {
        if (!alive) return;
        setState(r.ok ? "paired" : "failed");
      })
      .catch(() => {
        if (alive) setState("failed");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, state]);

  const setDigit = (i: number, v: string) => {
    const c = v.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = c;
      return next;
    });
    if (c && i < PIN_LEN - 1) inputs.current[i + 1]?.focus();
    if (state === "failed") setState("idle");
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <ShieldCheck className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Enter the pairing code
      </h2>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        Xpair is running on{" "}
        <span className="font-semibold text-foreground">{peer.name}</span>. Read the 6-digit code
        on its menu bar and type it here.
      </p>

      <div className="mt-5 flex gap-2">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            inputMode="numeric"
            maxLength={1}
            disabled={state === "pairing" || state === "paired"}
            aria-label={`Pairing code digit ${i + 1}`}
            className={
              "h-13 w-10 rounded-xl border bg-muted/40 text-center font-mono text-2xl font-semibold text-foreground outline-none transition-colors focus:border-primary disabled:opacity-60 " +
              (d ? "border-primary/45" : "border-border")
            }
          />
        ))}
      </div>

      {state === "pairing" && (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Pairing with {peer.name}…
        </div>
      )}
      {state === "paired" && (
        <div className="mt-4 flex items-center gap-2 text-xs text-primary">
          <Check className="h-3.5 w-3.5" />
          Paired — your key is registered on the host.
        </div>
      )}
      {state === "failed" && (
        <div className="mt-4 flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          Code didn't match or expired. Re-arm on the host and try again.
        </div>
      )}
      {state === "idle" && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-accent-lan/30 bg-accent-lan/5 px-3 py-2 text-xs text-accent-lan">
          <Check className="h-3.5 w-3.5" />
          No account password needed — the host registers your key.
        </div>
      )}

      <FingerprintPanel host={peer.name} fp={fp} />
    </div>
  );
}

export function FingerprintPanel({
  host,
  fp,
  firstTime,
}: {
  host: string;
  fp: string | null;
  firstTime?: boolean;
}) {
  return (
    <div className="mt-5 w-full rounded-xl border border-border bg-muted/30 p-3.5 text-left">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Lock className="h-3.5 w-3.5" />
        Host key fingerprint
      </div>
      <div className="mt-1.5 break-all font-mono text-[12.5px] leading-relaxed text-foreground">
        {fp || "fetching…"}
      </div>
      <div className="mt-2 text-[11.5px] text-muted-foreground">
        {firstTime
          ? `First time connecting — confirm this is the right Mac.`
          : `Matches what ${host} shows? You're connecting to the right Mac.`}
      </div>
    </div>
  );
}
