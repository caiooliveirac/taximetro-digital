"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { Ambulance, CheckCircle, Stethoscope, LogOut, MapPin, Sun, Moon, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { PreceptorProvider, usePreceptor, type PreceptorBase, type PreceptorShift } from "./preceptor-context";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { baseViewIndex } from "@/lib/base-colors";

const NAV = [
  { href: "/preceptor", label: "Validar", icon: CheckCircle },
  { href: "/preceptor/plantao", label: "Plantão", icon: Stethoscope },
];

function BaseDeclaration() {
  const { bases, loading, declare } = usePreceptor();
  const [selectedBase, setSelectedBase] = useState<string>("");
  const [selectedShift, setSelectedShift] = useState<PreceptorShift>("DAY");

  const sorted = [...bases].sort((a, b) => baseViewIndex(a.code) - baseViewIndex(b.code));

  if (loading) return <div className="flex items-center justify-center py-16 text-sm text-slate-400">Carregando bases...</div>;

  const base = sorted.find((b) => b.id === selectedBase);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="h-5 w-5 text-accent-500" strokeWidth={1.5} />
          <h2 className="text-lg font-semibold text-slate-900">Declarar Base</h2>
        </div>
        <p className="text-sm text-slate-500 mb-5">
          Informe em qual base e turno você está atuando. Isso delimita sua visão e responsabilidade de validação.
        </p>

        <label className="block text-xs font-medium text-slate-600 mb-1">Base</label>
        <select
          value={selectedBase}
          onChange={(e) => setSelectedBase(e.target.value)}
          className="mb-4 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent-500/30"
        >
          <option value="">Selecione a base...</option>
          {sorted.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} — {b.name}
            </option>
          ))}
        </select>

        <label className="block text-xs font-medium text-slate-600 mb-1">Turno</label>
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setSelectedShift("DAY")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
              selectedShift === "DAY"
                ? "border-amber-300 bg-amber-50 text-amber-700 font-medium"
                : "border-slate-200 text-slate-500 hover:bg-slate-50"
            )}
          >
            <Sun className="h-4 w-4" strokeWidth={1.5} /> Diurno
          </button>
          <button
            onClick={() => setSelectedShift("NIGHT")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors",
              selectedShift === "NIGHT"
                ? "border-indigo-300 bg-indigo-50 text-indigo-700 font-medium"
                : "border-slate-200 text-slate-500 hover:bg-slate-50"
            )}
          >
            <Moon className="h-4 w-4" strokeWidth={1.5} /> Noturno
          </button>
        </div>

        <Button
          className="w-full"
          disabled={!selectedBase}
          onClick={() => { if (base) declare(base, selectedShift); }}
        >
          Confirmar e Entrar
        </Button>
      </div>
    </div>
  );
}

function PreceptorInnerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { base, shift, clear } = usePreceptor();

  if (!base || !shift) return <BaseDeclaration />;

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
            onClick={() => signOut({ callbackUrl: "/login" })}
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
