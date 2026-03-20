"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Calendar } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { TableSkeleton } from "@/components/table-skeleton";
import { usePreceptor } from "../preceptor-context";
import { baseViewIndex } from "@/lib/base-colors";

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

  const today = new Date().toISOString().slice(0, 10);

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
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [base, shift]);

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
