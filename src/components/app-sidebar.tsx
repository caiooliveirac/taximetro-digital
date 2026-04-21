"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { sessionHasRole } from "@/lib/roles";
import { LogOut, Ambulance, Eye, Users, Stethoscope, GraduationCap, Menu, X, KeyRound, Loader2, type LucideIcon } from "lucide-react";
import { ImpersonateSelector } from "@/components/impersonate/impersonate-selector";
import { useImpersonate } from "@/components/impersonate/impersonate-provider";
import { RoleSwitcher } from "@/components/role-switcher";

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
  const router = useRouter();
  const { data: session, status } = useSession();
  const isCoordinator = session?.user?.role === "COORDINATOR";
  const { target: impersonateTarget, deactivate: stopImpersonate } = useImpersonate();
  const hasPreceptorRole = sessionHasRole(session, "PRECEPTOR");
  const canOpenPreceptorView = hasPreceptorRole && !impersonateTarget;
  const userName = session?.user?.name ?? "";
  const initials = userName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectorRole, setSelectorRole] = useState<"LEADER" | "PRECEPTOR" | "INTERN" | null>(null);
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [preceptorAccessError, setPreceptorAccessError] = useState("");
  const [preceptorRedirecting, setPreceptorRedirecting] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  function openPwModal() {
    setPwCurrent(""); setPwNew(""); setPwConfirm("");
    setPwError(""); setPwSuccess(false); setPwModalOpen(true);
  }

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault();
    if (pwNew.length < 8) { setPwError("Nova senha deve ter no mínimo 8 caracteres."); return; }
    if (pwNew !== pwConfirm) { setPwError("Senhas não conferem."); return; }
    setPwError(""); setPwLoading(true);
    try {
      const res = await fetch("/taximetro/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
      });
      const json = await res.json();
      if (!json.success) setPwError(json.error ?? "Erro ao alterar senha.");
      else setPwSuccess(true);
    } catch { setPwError("Erro de conexão."); }
    finally { setPwLoading(false); }
  }

  function handleOpenPreceptorView() {
    if (status !== "authenticated") {
      setPreceptorAccessError("Sessão indisponível. Entre novamente para acessar a visão de preceptoria.");
      return;
    }

    if (impersonateTarget) {
      setPreceptorAccessError("Pare o impersonate atual antes de entrar na visão de preceptoria.");
      return;
    }

    if (!hasPreceptorRole) {
      setPreceptorAccessError("Seu login atual ainda não trouxe a role de preceptoria. Saia e entre novamente.");
      return;
    }

    setPreceptorAccessError("");
    setPreceptorRedirecting(true);
    router.push("/preceptor");
  }

  const viewRoles: { role: "LEADER" | "PRECEPTOR" | "INTERN"; label: string; icon: typeof Users }[] = [
    { role: "LEADER", label: "Líder", icon: Users },
    { role: "PRECEPTOR", label: "Preceptor", icon: Stethoscope },
    { role: "INTERN", label: "Interno", icon: GraduationCap },
  ];

  const renderItem = (item: NavItem) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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

        {/* Switcher multi-role — so aparece se o usuario tiver >=2 roles */}
        <RoleSwitcher />

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

          {canOpenPreceptorView && (
            <div>
              <div className="my-2" />
              <p className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-navy-500 font-medium">
                Acesso Extra
              </p>
              <div className="space-y-2 px-3 pb-2 pt-1">
                <button
                  type="button"
                  onClick={handleOpenPreceptorView}
                  disabled={preceptorRedirecting}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-3 text-left text-white shadow-[0_12px_24px_rgba(16,185,129,0.22)] transition hover:from-emerald-400 hover:to-teal-400 disabled:cursor-wait disabled:opacity-70"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    {preceptorRedirecting ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" strokeWidth={1.8} /> : <Stethoscope className="h-5 w-5 shrink-0" strokeWidth={1.8} />}
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">Entrar como preceptora</span>
                      <span className="block truncate text-[11px] text-white/80">Valida a sua auth e abre a tela de check-in</span>
                    </span>
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/80">Abrir</span>
                </button>
                {preceptorAccessError && <p className="text-xs text-amber-300">{preceptorAccessError}</p>}
              </div>
            </div>
          )}
        </nav>

        {/* Bottom */}
        <div className="p-2 border-t border-navy-800 space-y-1">
          {isCoordinator && (
            <>
              <p className="flex items-center gap-2 px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-widest text-navy-500 font-medium">
                <Eye className="h-3 w-3" />
                Visualizar como
              </p>
              {viewRoles.map((vr) => (
                <button
                  key={vr.role}
                  onClick={() => setSelectorRole(vr.role)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-navy-800 hover:text-slate-200 transition-colors duration-150"
                >
                  <vr.icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
                  {vr.label}
                </button>
              ))}
              {impersonateTarget && (
                <button
                  onClick={stopImpersonate}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-amber-400 hover:bg-navy-800 hover:text-amber-200 transition-colors duration-150"
                >
                  <X className="h-[18px] w-[18px]" strokeWidth={1.5} />
                  Parar impersonate
                </button>
              )}
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
              onClick={openPwModal}
              className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-navy-800 hover:text-slate-300 transition-colors duration-150"
              title="Alterar senha"
            >
              <KeyRound className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <button
              onClick={() => signOut({ callbackUrl: "/taximetro/login" })}
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
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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

              {canOpenPreceptorView && (
                <div>
                  <div className="my-1 border-t border-slate-100" />
                  <p className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-slate-400 font-medium">Acesso Extra</p>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      handleOpenPreceptorView();
                    }}
                    disabled={preceptorRedirecting}
                    className="flex w-full items-center gap-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-3 text-left text-sm font-medium text-white transition disabled:cursor-wait disabled:opacity-70"
                  >
                    {preceptorRedirecting ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" strokeWidth={1.8} /> : <Stethoscope className="h-5 w-5 shrink-0" strokeWidth={1.8} />}
                    Entrar como preceptora
                  </button>
                  {preceptorAccessError && <p className="px-3 pt-2 text-xs text-amber-600">{preceptorAccessError}</p>}
                </div>
              )}
            </div>
            {isCoordinator && (
              <div className="px-3 pb-2">
                <div className="my-1 border-t border-slate-100" />
                <p className="flex items-center gap-2 px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest text-slate-400 font-medium">
                  <Eye className="h-3 w-3" />Visualizar como
                </p>
                {viewRoles.map((vr) => (
                  <button key={vr.role} onClick={() => { setMobileMenuOpen(false); setSelectorRole(vr.role); }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    <vr.icon className="h-5 w-5 shrink-0" strokeWidth={1.5} />{vr.label}
                  </button>
                ))}
                {impersonateTarget && (
                  <button onClick={() => { setMobileMenuOpen(false); stopImpersonate(); }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm text-amber-600 hover:bg-amber-50 transition-colors"
                  >
                    <X className="h-5 w-5 shrink-0" strokeWidth={1.5} />Parar impersonate
                  </button>
                )}
              </div>
            )}
            <div className="border-t border-slate-100 px-5 py-4 flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-accent-400">{initials || "?"}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{userName || "Usuário"}</p>
                <p className="text-[10px] text-slate-400">{role}</p>
              </div>
              <button onClick={() => { setMobileMenuOpen(false); openPwModal(); }}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <KeyRound className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button onClick={() => signOut({ callbackUrl: "/taximetro/login" })}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.5} />Sair
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password change modal */}
      {pwModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setPwModalOpen(false)} />
          <div className="relative w-full max-w-sm mx-4 rounded-2xl bg-white p-6 shadow-xl">
            <button onClick={() => setPwModalOpen(false)} className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Alterar Senha</h2>
            {pwSuccess ? (
              <div className="text-center space-y-3">
                <p className="text-sm text-green-700 font-medium">Senha alterada com sucesso!</p>
                <button onClick={() => setPwModalOpen(false)} className="text-sm text-accent-600 hover:text-accent-500 font-medium">Fechar</button>
              </div>
            ) : (
              <form onSubmit={handleChangePw} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Senha atual</label>
                  <input type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} required autoComplete="current-password"
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Nova senha</label>
                  <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} required autoComplete="new-password" placeholder="Mín. 8 caracteres"
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Confirmar nova senha</label>
                  <input type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} required autoComplete="new-password"
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500" />
                </div>
                {pwError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{pwError}</p>}
                <button type="submit" disabled={pwLoading}
                  className="w-full rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-500 transition-colors disabled:opacity-50">
                  {pwLoading ? "Alterando..." : "Alterar Senha"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Impersonate user selector */}
      {selectorRole && (
        <ImpersonateSelector
          role={selectorRole}
          open={!!selectorRole}
          onClose={() => setSelectorRole(null)}
        />
      )}
    </>
  );
}
