"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Shield, Users, Stethoscope, GraduationCap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Role = "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN";

const ROLE_ORDER: Role[] = ["COORDINATOR", "LEADER", "PRECEPTOR", "INTERN"];

const ROLE_META: Record<Role, { href: string; label: string; icon: LucideIcon }> = {
  COORDINATOR: { href: "/admin", label: "Admin", icon: Shield },
  LEADER: { href: "/leader", label: "Líder", icon: Users },
  PRECEPTOR: { href: "/preceptor", label: "Preceptor", icon: Stethoscope },
  INTERN: { href: "/intern", label: "Interno", icon: GraduationCap },
};

/**
 * Mostra atalhos para as areas das roles que o usuario possui.
 * So aparece quando o usuario tem pelo menos duas roles distintas.
 * A navegacao e' feita via <Link> (o middleware ja permite acesso a
 * qualquer prefixo correspondente a uma role ativa em token.roles[]).
 */
export function RoleSwitcher() {
  const { data: session } = useSession();
  const pathname = usePathname();

  const rawRoles = session?.user?.roles ?? [];
  const roleSet = new Set<Role>();
  for (const entry of rawRoles) {
    if (typeof entry === "string") {
      roleSet.add(entry as Role);
    } else if (entry && typeof entry === "object" && "role" in entry) {
      roleSet.add((entry as { role: Role }).role);
    }
  }

  if (roleSet.size < 2) return null;

  const items = ROLE_ORDER.filter((r) => roleSet.has(r)).map((r) => ROLE_META[r]);
  if (items.length < 2) return null;

  return (
    <div className="border-b border-navy-800 px-3 py-3">
      <p className="px-1 pb-1.5 text-[10px] uppercase tracking-widest text-navy-500 font-medium">
        Minhas áreas
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "bg-accent-500 text-white"
                  : "bg-navy-800 text-slate-300 hover:bg-navy-700 hover:text-white",
              )}
              title={`Abrir área ${item.label}`}
            >
              <item.icon className="h-3.5 w-3.5" strokeWidth={1.8} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
