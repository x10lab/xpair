type Props = { total: number; current: number };

export function StepProgress({ total, current }: Props) {
  return (
    <div className="flex items-center gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={
            "h-1.5 rounded-full transition-all duration-300 " +
            (i === current
              ? "w-6 bg-primary"
              : i < current
              ? "w-1.5 bg-primary/60"
              : "w-1.5 bg-border")
          }
        />
      ))}
    </div>
  );
}
