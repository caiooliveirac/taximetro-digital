"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { Ambulance, CheckCircle, Stethoscope, LogOut, MapPin, Sun, Moon, RefreshCw } from "lucide-react";
import { cn, operationalPeriod } from "@/lib/utils";
import { PreceptorProvider, usePreceptor, type PreceptorBase, type PreceptorShift } from "./preceptor-context";
import { useState } from "react";
import { BASE_VIEW_ORDER, getBaseStyleByCode } from "@/lib/base-colors";

const NAV = [
  { href: "/preceptor", label: "Validar", icon: CheckCircle },
  { href: "/preceptor/plantao", label: "Plantão", icon: Stethoscope },
];

// Entrada do preceptor: um toque na base onde está. CRU e CRL primeiro e
// maiores; as 12 USAs em grade 3×4. Cabe numa tela de celular sem rolar.
// O turno vem da hora (07h–19h diurno) e troca no seletor do topo.
function BaseGrid() {
  const { bases, loading, declare } = usePreceptor();
  const [selectedShift, setSelectedShift] = useState<PreceptorShift>(() => operationalPeriod());

  if (loading) return <div className="flex items-center justify-center py-16 text-sm text-slate-400">Carregando bases...</div>;

  const byCode = new Map(bases.map((b) => [b.code, b]));
  const centrais = (["CRU", "CRL"] as const).map((code) => byCode.get(code)).filter((b): b is PreceptorBase => Boolean(b));
  const usas = BASE_VIEW_ORDER.map((code) => byCode.get(code)).filter((b): b is PreceptorBase => Boolean(b));
  const outras = bases
    .filter((b) => b.type === "USA" && !usas.includes(b))
    .sort((a, b) => a.code.localeCompare(b.code));

  return (
    <div className="flex h-[100dvh] flex-col gap-3 bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Ambulance className="h-5 w-5 shrink-0 text-accent-500" strokeWidth={1.5} />
          <h1 className="truncate text-base font-semibold text-slate-900">Onde você está?</h1>
        </div>
        <div className="flex shrink-0 rounded-lg border border-slate-200 bg-white p-0.5">
          {(["DAY", "NIGHT"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSelectedShift(value)}
              aria-pressed={selectedShift === value}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                selectedShift === value
                  ? value === "DAY" ? "bg-amber-100 text-amber-800" : "bg-indigo-100 text-indigo-800"
                  : "text-slate-500",
              )}
            >
              {value === "DAY" ? <Sun className="h-3.5 w-3.5" strokeWidth={1.8} /> : <Moon className="h-3.5 w-3.5" strokeWidth={1.8} />}
              {value === "DAY" ? "Diurno" : "Noturno"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-[1.3] grid-cols-2 gap-3">
        {centrais.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => declare(b, selectedShift)}
            className={cn(
              "flex flex-col items-center justify-center rounded-2xl px-2 text-white shadow-sm transition active:scale-[0.98]",
              b.code === "CRU" ? "bg-slate-900 hover:bg-slate-800" : "bg-accent-500 hover:bg-accent-600",
            )}
          >
            <span className="text-3xl font-bold tracking-tight">{b.code}</span>
            <span className="mt-0.5 line-clamp-1 text-xs text-white/75">{b.name}</span>
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-[3] grid-cols-3 grid-rows-4 gap-2">
        {usas.map((b) => {
          const style = getBaseStyleByCode(b.code);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => declare(b, selectedShift)}
              className={cn(
                "flex min-h-0 flex-col items-center justify-center rounded-xl border px-1 transition active:scale-[0.97]",
                style.bg, style.border, style.text,
              )}
            >
              <span className="text-lg font-bold leading-none">{b.code}</span>
              <span className="mt-1 line-clamp-1 text-[10px] text-slate-500">{b.name}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {outras.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => declare(b, selectedShift)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700"
            >
              {b.code}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/taximetro/login" })}
          className="flex shrink-0 items-center gap-1 text-slate-400 hover:text-slate-600"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} /> Sair
        </button>
      </div>
    </div>
  );
}

function PreceptorInnerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { base, shift, clear } = usePreceptor();

  if (!base || !shift) return <BaseGrid />;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2">
          <Ambulance className="h-5 w-5 text-accent-500" strokeWidth={1.5} />
          <div>
            <h2 className="font-semibold text-slate-900 text-sm">Taxímetro</h2>
            <p className="text-[10px] text-slate-500">Preceptor</p>
          </div>
        </div>

        {/* Active base badge */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 ring-1 ring-accent-600/10">
            <MapPin className="h-3 w-3" strokeWidth={1.5} />
            {base.code}
            <span className="mx-0.5 text-accent-300">|</span>
            {shift === "DAY" ? (
              <span className="flex items-center gap-0.5"><Sun className="h-3 w-3 text-amber-500" strokeWidth={1.5} /> Diurno</span>
            ) : (
              <span className="flex items-center gap-0.5"><Moon className="h-3 w-3 text-indigo-500" strokeWidth={1.5} /> Noturno</span>
            )}
          </div>
          <button
            onClick={clear}
            title="Trocar base"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors duration-150",
                pathname === item.href
                  ? "bg-accent-50 text-accent-700 font-medium"
                  : "text-slate-500 hover:bg-slate-100"
              )}
            >
              <item.icon className="h-4 w-4" strokeWidth={1.5} />
              {item.label}
            </Link>
          ))}
          <button
            onClick={() => signOut({ callbackUrl: "/taximetro/login" })}
            className="ml-2 flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </header>
      <main className="flex-1 bg-background p-4">{children}</main>
    </div>
  );
}

export default function PreceptorLayout({ children }: { children: React.ReactNode }) {
  return (
    <PreceptorProvider>
      <PreceptorInnerLayout>{children}</PreceptorInnerLayout>
    </PreceptorProvider>
  );
}
