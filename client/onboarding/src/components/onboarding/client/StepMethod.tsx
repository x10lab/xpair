import { Key, Globe } from "lucide-react";

export type ConnectMethod = "ssh" | "web";

type Props = {
  value: ConnectMethod | null;
  onChange: (m: ConnectMethod) => void;
};

export function StepMethod({ value, onChange }: Props) {
  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        How will you connect?
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Pick the transport between this Mac and the host.
      </p>

      <div className="mt-6 grid gap-3">
        <MethodCard
          active={value === "ssh"}
          onClick={() => onChange("ssh")}
          icon={<Key className="h-4 w-4" />}
          title="SSH key"
          desc="Password-less SSH using a key in ~/.ssh. Recommended."
          badge="Recommended"
        />
        <MethodCard
          active={value === "web"}
          onClick={() => onChange("web")}
          icon={<Globe className="h-4 w-4" />}
          title="Web bridge"
          desc="Connect through a browser-based bridge. Not implemented yet."
          badge="Coming soon"
          disabled
        />
      </div>

      {value === "web" && (
        <div className="mt-4 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          The web bridge isn't shipped in v0.5. Pick SSH key to continue.
        </div>
      )}
    </div>
  );
}

function MethodCard({
  active,
  onClick,
  icon,
  title,
  desc,
  badge,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  badge?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex items-start gap-3 rounded-xl border p-4 text-left transition-all " +
        (active
          ? "border-primary bg-primary/5"
          : "border-border hover:border-foreground/20 hover:bg-muted/30") +
        (disabled ? " opacity-70" : "")
      }
    >
      <div
        className={
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " +
          (active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")
        }
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {badge && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
    </button>
  );
}
