"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Calendar, LogOut, Loader2, CheckCircle } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { TableSkeleton } from "@/components/table-skeleton";
import { Button } from "@/components/ui/button";
import { usePreceptor } from "../preceptor-context";
import { baseViewIndex } from "@/lib/base-colors";
import { localDateStr } from "@/lib/utils";

type Assignment = {
  id: string;
  internName: string;
  baseCode: string;
  baseName: string;
  period: string;
  status: string;
  facultyAbbr: string;
};

export default function PreceptorPlantao() {
  const { base, shift } = usePreceptor();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const today = localDateStr();

  useEffect(() => {
    if (!base || !shift) return;
    const params = new URLSearchParams({ from: today, to: today, baseId: base.id, period: shift });
    fetch(`/taximetro/api/assignments?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          const sorted = json.data
            .filter((a: Assignment) => a.status !== "CANCELLED")
            .sort((a: Assignment, b: Assignment) => baseViewIndex(a.baseCode) - baseViewIndex(b.baseCode));
          setAssignments(sorted);
        }
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [base, shift]);

  async function handleCheckout(assignmentId: string) {
    if (confirming !== assignmentId) {
      setConfirming(assignmentId);
      return;
    }
    setCheckingOut(assignmentId);
    try {
      const res = await fetch("/taximetro/api/attendance/checkout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId }),
      });
      const data = await res.json();
      if (data.success) {
        setAssignments((prev) =>
          prev.map((a) => (a.id === assignmentId ? { ...a, status: "CHECKED_OUT" } : a))
        );
      }
    } catch { /* ignore */ }
    setCheckingOut(null);
    setConfirming(null);
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Plantão de Hoje</h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
          <Calendar className="h-3.5 w-3.5" strokeWidth={1.5} />
          {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      {loading ? <TableSkeleton rows={5} cols={5} /> : assignments.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">Nenhum interno escalado na sua base/turno hoje.</p>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Interno</TableHead>
                <TableHead>Faculdade</TableHead>
                <TableHead>Base</TableHead>
                <TableHead>Turno</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.internName}</TableCell>
                  <TableCell className="text-xs">{a.facultyAbbr}</TableCell>
                  <TableCell>{a.baseCode} — {a.baseName}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1">
                      {a.period === "DAY" ? <Sun className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.5} /> : <Moon className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />}
                      {a.period === "DAY" ? "Diurno" : "Noturno"}
                    </span>
                  </TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell className="text-right">
                    {a.status === "CHECKED_IN" ? (
                      <Button
                        size="sm"
                        variant={confirming === a.id ? "default" : "outline"}
                        className={confirming === a.id ? "bg-blue-600 hover:bg-blue-700 text-white gap-1" : "gap-1"}
                        disabled={checkingOut === a.id}
                        onClick={() => handleCheckout(a.id)}
                      >
                        {checkingOut === a.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : confirming === a.id ? (
                          <><CheckCircle className="h-3.5 w-3.5" /> Confirmar</>
                        ) : (
                          <><LogOut className="h-3.5 w-3.5" /> Checkout</>
                        )}
                      </Button>
                    ) : a.status === "CHECKED_OUT" ? (
                      <span className="text-xs text-blue-500 font-medium">Encerrado</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t border-slate-100 px-4 py-2">
            <span className="text-xs text-slate-400">{assignments.length} interno(s)</span>
          </div>
        </div>
      )}
    </div>
  );
}
