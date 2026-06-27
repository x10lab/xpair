import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepProgress } from "./StepProgress";

type Props = {
  title: string;
  subtitle?: string;
  step: number;
  totalSteps: number;
  onPrev?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  hidePrev?: boolean;
  hideFooter?: boolean;
  footerSlot?: ReactNode;
  centerSlot?: ReactNode;
  children: ReactNode;
};

export function WizardShell({
  title,
  subtitle,
  step,
  totalSteps,
  onPrev,
  onNext,
  nextLabel = "Next",
  nextDisabled,
  hidePrev,
  hideFooter,
  footerSlot,
  centerSlot,
  children,
}: Props) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-card text-foreground">
      <div
        className="flex items-center justify-between border-b border-border/60 px-6 py-4 pl-20"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground">{title}</h1>
          {subtitle && (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <StepProgress total={totalSteps} current={step} />
        </div>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-8 py-8">{children}</div>

      {!hideFooter && (
        <div
          className="grid grid-cols-[1fr_minmax(0,180px)_1fr] items-center gap-3 border-t border-border/60 bg-muted/20 px-6 py-4"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div className="justify-self-start">
            {!hidePrev && step > 0 && (
              <Button variant="ghost" size="sm" onClick={onPrev}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                Previous
              </Button>
            )}
          </div>
          <div className="min-w-0">{centerSlot}</div>
          <div className="flex items-center justify-end gap-2">
            {footerSlot}
            {onNext && (
              <Button size="sm" onClick={onNext} disabled={nextDisabled}>
                {nextLabel}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
