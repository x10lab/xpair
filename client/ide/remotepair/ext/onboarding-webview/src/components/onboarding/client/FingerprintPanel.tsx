import { useState } from "react";
import { ChevronDown, Lock } from "lucide-react";

/**
 * Host-key fingerprint panel for SSH TOFU (trust-on-first-use). Shown on the connect/reconnect
 * steps so the user can confirm the host key matches the Mac they expect before any key is trusted.
 * Collapsed by default — the fingerprint is a verification detail most users glance past.
 */
export function FingerprintPanel({
  host,
  fp,
  firstTime,
}: {
  host: string;
  fp: string | null;
  firstTime?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5 w-full overflow-hidden rounded-xl border border-border bg-muted/30 text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 p-3.5 text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        <Lock className="h-3.5 w-3.5" />
        Host key fingerprint
        <ChevronDown
          className={"ml-auto h-3.5 w-3.5 transition-transform " + (open ? "rotate-180" : "")}
        />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5">
          <div className="break-all font-mono text-[12.5px] leading-relaxed text-foreground">
            {fp || "fetching…"}
          </div>
          <div className="mt-2 text-[11.5px] text-muted-foreground">
            {firstTime
              ? `First time connecting — confirm this is the right Mac.`
              : `Matches what ${host} shows? You're connecting to the right Mac.`}
          </div>
        </div>
      )}
    </div>
  );
}
