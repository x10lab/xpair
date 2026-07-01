import { Server } from "lucide-react";
import { LangToggle } from "@/components/onboarding/LangToggle";
import { ConsentControls } from "@/components/onboarding/host/ConsentControls";
import { useT } from "@/lib/i18n";

export function StepWelcome() {
  const { t } = useT();

  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Server className="h-7 w-7" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">
        {t("host.welcome.title")}
      </h2>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        {t("host.welcome.desc")}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Tap <span className="font-medium text-foreground">{t("shell.beginSetup")}</span> to grant the screen permission.
      </p>
      <LangToggle />
      <ul className="mt-6 w-full max-w-sm space-y-2 text-left text-sm text-muted-foreground">
        <Bullet>Grant Screen Recording (required)</Bullet>
        <Bullet>Optionally grant Full Disk Access</Bullet>
      </ul>
      {/* Consent decided up-front (opt-in, both default OFF). Re-toggleable on the Done step. */}
      <div className="mt-6">
        <ConsentControls variant="prompt" />
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
      <span>{children}</span>
    </li>
  );
}
