import { Laptop } from "lucide-react";

export function StepWelcome() {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Laptop className="h-7 w-7" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">
        Welcome to Xpair
      </h2>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">
        Attach to a Mac running XpairHost and work as if it were sitting
        on your desk. Let's get you connected.
      </p>
      <ul className="mt-8 w-full max-w-sm space-y-2 text-left text-sm text-muted-foreground">
        <Bullet>Find your host Mac on the network</Bullet>
        <Bullet>Verify SSH key-based access</Bullet>
        <Bullet>Map folders between host and client</Bullet>
      </ul>
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
