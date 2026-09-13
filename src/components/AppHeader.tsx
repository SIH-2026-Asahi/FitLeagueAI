import { Zap } from "lucide-react";

export function AppHeader({ subtitle }: { subtitle: string }) {
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
      <div className="min-w-0">
        <p className="font-display text-lg font-bold uppercase leading-none tracking-[0.18em] text-primary text-glow">
          Fit League <span className="text-accent">AI</span>
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/40 bg-primary/10 text-primary">
        <Zap className="h-5 w-5" />
      </span>
    </header>
  );
}
