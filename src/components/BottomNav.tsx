import { Link } from "@tanstack/react-router";
import { Dumbbell, Trophy, Users } from "lucide-react";

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-card/85 backdrop-blur-xl">
      <div className="mx-auto grid max-w-md grid-cols-3 gap-1 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        <NavItem to="/" label="Workout" icon={<Dumbbell className="h-5 w-5" />} />
        <NavItem to="/progress" label="Progress" icon={<Trophy className="h-5 w-5" />} />
        <NavItem to="/league" label="League" icon={<Users className="h-5 w-5" />} />
      </div>
    </nav>
  );
}

function NavItem({
  to,
  label,
  icon,
}: {
  to: "/" | "/progress" | "/league";
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: true }}
      className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-widest text-muted-foreground transition-colors"
      activeProps={{ className: "bg-primary/10 text-primary text-glow" }}
    >
      {icon}
      {label}
    </Link>
  );
}
