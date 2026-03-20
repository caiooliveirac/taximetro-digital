"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { LogOut, Ambulance, Eye, Users, Stethoscope, GraduationCap, Menu, X, type LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type NavGroup = {
  label?: string;
  items: NavItem[];
};

export function AppSidebar({
  nav,
  role,
  groups,
  navGroups,
}: {
  nav: NavItem[];
  role: string;
  groups?: number[][];
  navGroups?: NavGroup[];
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isCoordinator = session?.user?.role === "COORDINATOR";
  const userName = session?.user?.name ?? "";
  const initials = userName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const viewLinks = [
    { href: "/leader", label: "Líder", icon: Users },
    { href: "/preceptor", label: "Preceptor", icon: Stethoscope },
    { href: "/intern", label: "Interno", icon: GraduationCap },
  ];

  const renderItem = (item: NavItem) => {
    const active = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150",
          active
            ? "border-l-[3px] border-accent-500 bg-navy-700 pl-[9px] text-white font-medium"
            : "text-slate-400 hover:bg-navy-800 hover:text-slate-200"
        )}
      >
        <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
        <span>{item.label}</span>
      </Link>
    );
  };

  // Build groups from navGroups (new API) or legacy groups array
  const sections: NavGroup[] = navGroups ?? (() => {
    const result: NavGroup[] = [];
    if (groups) {
      let idx = 0;
      for (const g of groups) {
        result.push({ items: nav.slice(idx, idx + g[0]) });
        idx += g[0];
      }
      if (idx < nav.length) result.push({ items: nav.slice(idx) });
    } else {
      result.push({ items: nav });
    }
    return result;
  })();

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:w-60 lg:flex-col bg-navy-900 min-h-screen">
        {/* Logo + role */}
        <div className="p-4 border-b border-navy-800">
          <div className="flex items-center gap-2">
            <Ambulance className="h-5 w-5 text-accent-500" strokeWidth={1.5} />
            <div>
              <h2 className="font-semibold text-white text-[15px] leading-tight">Taxímetro</h2>
              <p className="text-[10px] text-slate-400">SAMU Salvador</p>
            </div>
          </div>
          <div className="mt-2">
            <span className="inline-flex items-center rounded-full bg-navy-700 px-2.5 py-0.5 text-[10px] font-medium text-accent-400 ring-1 ring-accent-500/20">
              {role}
            </span>
          </div>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {sections.map((group, gi) => (
            <div key={gi}>
              {gi > 0 && <div className="my-2" />}
              {group.label && (
                <p className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-navy-500 font-medium">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map(renderItem)}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div className="p-2 border-t border-navy-800 space-y-1">
          {isCoordinator && (
            <>
              <p className="flex items-center gap-2 px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-widest text-navy-500 font-medium">
                <Eye className="h-3 w-3" />
                Visualizar como
              </p>
              {viewLinks.map((vl) => (
                <Link
                  key={vl.href}
                  href={vl.href}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-navy-800 hover:text-slate-200 transition-colors duration-150"
                >
                  <vl.icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
                  {vl.label}
                </Link>
              ))}
              <div className="border-t border-navy-800 my-1" />
            </>
          )}

          {/* User info + logout */}
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-700 text-xs font-semibold text-accent-400">
              {initials || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-200">{userName || "Usuário"}</p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-navy-800 hover:text-slate-300 transition-colors duration-150"
              title="Sair"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-around border-t border-slate-200 bg-white py-2 lg:hidden shadow-[0_-1px_3px_rgba(0,0,0,0.06)]">
        {(nav.length > 5 ? nav.slice(0, 4) : nav.slice(0, 5)).map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 text-[10px] font-medium transition-colors",
                active ? "text-accent-600" : "text-slate-400"
              )}
            >
              <item.icon className="h-5 w-5" strokeWidth={active ? 2 : 1.5} />
              {item.label}
            </Link>
          );
        })}
        {nav.length > 5 && (
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="flex flex-col items-center gap-0.5 text-[10px] font-medium text-slate-400 transition-colors"
          >
            <Menu className="h-5 w-5" strokeWidth={1.5} />
            Mais
          </button>
        )}
      </nav>

      {/* Mobile sheet overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setMobileMenuOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-white shadow-xl max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4 rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Ambulance className="h-5 w-5 text-accent-500" strokeWidth={1.5} />
                <span className="font-semibold text-slate-900">Menu</span>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition-colors">
                <X className="h-5 w-5" strokeWidth={1.5} />
              </button>
            </div>
            <div className="px-3 py-2">
              {sections.map((group, gi) => (
                <div key={gi}>
                  {gi > 0 && <div className="my-1 border-t border-slate-100" />}
                  {group.label && (
                    <p className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-slate-400 font-medium">{group.label}</p>
                  )}
                  {group.items.map((item) => {
                    const active = pathname === item.href;
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)}
                        className={cn("flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors",
                          active ? "bg-accent-50 text-accent-700 font-medium" : "text-slate-600 hover:bg-slate-50"
                        )}
                      >
                        <item.icon className="h-5 w-5 shrink-0" strokeWidth={1.5} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
            {isCoordinator && (
              <div className="px-3 pb-2">
                <div className="my-1 border-t border-slate-100" />
                <p className="flex items-center gap-2 px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-slate-400 font-medium">
                  <Eye className="h-3 w-3" />Visualizar como
                </p>
                {viewLinks.map((vl) => (
                  <Link key={vl.href} href={vl.href} onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <vl.icon className="h-5 w-5 shrink-0" strokeWidth={1.5} />{vl.label}
                  </Link>
                ))}
              </div>
            )}
            <div className="border-t border-slate-100 px-5 py-4 flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-accent-400">{initials || "?"}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{userName || "Usuário"}</p>
                <p className="text-[10px] text-slate-400">{role}</p>
              </div>
              <button onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.5} />Sair
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
