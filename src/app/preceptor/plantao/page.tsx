"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Calendar, LogOut, Loader2, Frown, Meh, Smile } from "lucide-react";
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

type NpsAnswer = "SAD" | "NEUTRAL" | "HAPPY";

type CheckoutNps = {
  knowledge: NpsAnswer | null;
  proactivity: NpsAnswer | null;
  punctuality: NpsAnswer | null;
};

const EMPTY_NPS: CheckoutNps = {
  knowledge: null,
  proactivity: null,
  punctuality: null,
};

const NPS_OPTIONS: Array<{ value: NpsAnswer; label: string; Icon: typeof Frown }> = [
  { value: "SAD", label: "Triste", Icon: Frown },
  { value: "NEUTRAL", label: "Neutra", Icon: Meh },
  { value: "HAPPY", label: "Feliz", Icon: Smile },
];

export default function PreceptorPlantao() {
  const { base, shift } = usePreceptor();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [selectedCheckout, setSelectedCheckout] = useState<Assignment | null>(null);
  const [checkoutNps, setCheckoutNps] = useState<CheckoutNps>(EMPTY_NPS);
  const [checkoutObservations, setCheckoutObservations] = useState("");

  const today = localDateStr();

  useEffect(() => {
    if (!base || !shift) return;
    const params = new URLSearchParams({ from: today, to: today, baseId: base.id, period: shift });
    fetch(`/taximetro/api/assignments?${params}`, { headers: { "x-force-role": "PRECEPTOR" } })
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

  async function handleCheckout(assignmentId: string, nps: CheckoutNps, notes: string) {
    setCheckingOut(assignmentId);
    try {
      const res = await fetch("/taximetro/api/attendance/checkout", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-force-role": "PRECEPTOR" },
        body: JSON.stringify({ assignmentId, nps, notes }),
      });
      const data = await res.json();
      if (data.success) {
        const checkedOutIds: string[] = Array.isArray(data.data?.assignmentIds)
          ? data.data.assignmentIds
          : [assignmentId];
        setAssignments((prev) =>
          prev.map((a) => (checkedOutIds.includes(a.id) ? { ...a, status: "CHECKED_OUT" } : a))
        );
        setSelectedCheckout(null);
        setCheckoutNps(EMPTY_NPS);
        setCheckoutObservations("");
      }
    } catch { /* ignore */ }
    setCheckingOut(null);
  }

  function openCheckoutNps(assignment: Assignment) {
    if (selectedCheckout?.id === assignment.id) {
      setSelectedCheckout(null);
      setCheckoutNps(EMPTY_NPS);
      setCheckoutObservations("");
      return;
    }
    setSelectedCheckout(assignment);
    setCheckoutNps(EMPTY_NPS);
    setCheckoutObservations("");
  }

  function setNpsAnswer(question: keyof CheckoutNps, value: NpsAnswer) {
    setCheckoutNps((prev) => ({ ...prev, [question]: value }));
  }

  const canSubmitNps = checkoutNps.knowledge && checkoutNps.proactivity && checkoutNps.punctuality;

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
                        variant={selectedCheckout?.id === a.id ? "default" : "outline"}
                        className="gap-1"
                        disabled={checkingOut === a.id}
                        onClick={() => openCheckoutNps(a)}
                      >
                        {checkingOut === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><LogOut className="h-3.5 w-3.5" /> Checkout</>}
                      </Button>
                    ) : a.status === "CHECKED_OUT" ? (
                      <span className="text-xs text-blue-500 font-medium">Encerrado</span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {selectedCheckout && selectedCheckout.status === "CHECKED_IN" && (
            <div className="border-t border-slate-100 p-4">
              <p className="text-xs font-semibold text-slate-700">
                Checkout de {selectedCheckout.internName}: responda as 3 perguntas antes de confirmar.
              </p>
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-xs text-slate-600">Conhecimentos apresentados</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {NPS_OPTIONS.map(({ value, label, Icon }) => (
                      <Button
                        key={`knowledge-${value}`}
                        type="button"
                        size="sm"
                        variant={checkoutNps.knowledge === value ? "default" : "outline"}
                        onClick={() => setNpsAnswer("knowledge", value)}
                        className="min-w-24"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Proatividade</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {NPS_OPTIONS.map(({ value, label, Icon }) => (
                      <Button
                        key={`proactivity-${value}`}
                        type="button"
                        size="sm"
                        variant={checkoutNps.proactivity === value ? "default" : "outline"}
                        onClick={() => setNpsAnswer("proactivity", value)}
                        className="min-w-24"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Pontualidade</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {NPS_OPTIONS.map(({ value, label, Icon }) => (
                      <Button
                        key={`punctuality-${value}`}
                        type="button"
                        size="sm"
                        variant={checkoutNps.punctuality === value ? "default" : "outline"}
                        onClick={() => setNpsAnswer("punctuality", value)}
                        className="min-w-24"
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-xs text-slate-600">Observações do preceptor (opcional)</p>
                  <textarea
                    value={checkoutObservations}
                    onChange={(e) => setCheckoutObservations(e.target.value)}
                    placeholder="Ex.: conduta, intercorrências, pontos de atenção"
                    maxLength={2000}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelectedCheckout(null);
                      setCheckoutNps(EMPTY_NPS);
                      setCheckoutObservations("");
                    }}
                    disabled={checkingOut === selectedCheckout.id}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleCheckout(selectedCheckout.id, checkoutNps, checkoutObservations)}
                    disabled={checkingOut === selectedCheckout.id || !canSubmitNps}
                    className="gap-1"
                  >
                  {checkingOut === selectedCheckout.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                  Confirmar checkout
                </Button>
              </div>
            </div>
          </div>
          )}
          <div className="border-t border-slate-100 px-4 py-2">
            <span className="text-xs text-slate-400">{assignments.length} interno(s)</span>
          </div>
        </div>
      )}
    </div>
  );
}
