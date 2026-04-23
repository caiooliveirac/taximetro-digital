"use client";

import { Fragment, useEffect, useMemo, useState, useCallback } from "react";
import {
  Search, Filter, ChevronLeft, ChevronRight,
  Dices, X, RotateCcw, UserX, Plus,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useImpersonate } from "@/components/impersonate/impersonate-provider";
import { getBaseStyle, getPeriodStyle } from "@/lib/base-colors";
import { addDaysToDateStr, localDateStr, startOfWeekDateStr } from "@/lib/utils";

/* ────────── Types ────────── */

type InternRole = { id: string; name: string; userActive: boolean; roleActive: boolean; isArchived: boolean };
type Base = { id: string; code: string; name: string; type: string };
type Assignment = {
  id: string; internId: string; internName: string;
  baseId: string; baseCode: string; baseName: string; baseType: string;
  date: string; period: string; shift: string | null; status: string;
  notes?: string | null;
  isExtraShift?: boolean; extraShiftNotes?: string | null;
  checkinGeoValid?: boolean | null;
};
type Slot = {
  ruleId: string; baseId: string; baseCode: string; baseName: string; baseType: string;
  dayOfWeek: string; period: string; capacity: number; filled: number; available: number;
  nextDate: string; facultyAbbr?: string; isExtraShift?: boolean;
};
type CruFixed = {
  id: string; intern_id: string; intern_name: string;
  day_of_week: string; period: string; valid_until: string;
};
type CruConflictItem = {
  assignmentId: string;
  baseCode: string;
  date: string;
  period: "DAY" | "NIGHT";
  status: string;
  internName: string;
};
type CruConflictPending = {
  internId: string;
  dayOfWeek: string;
  period: "DAY" | "NIGHT";
  weeks: number;
  conflicts: CruConflictItem[];
};

const PERIODS = ["DAY", "NIGHT"] as const;
const DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const DOW_KEYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const DOW_IDX: Record<(typeof DOW_KEYS)[number], number> = {
  MON: 0,
  TUE: 1,
  WED: 2,
  THU: 3,
  FRI: 4,
  SAT: 5,
  SUN: 6,
};
const BASE_ORDER = ["SM01", "PM04", "PM40", "CN10", "PR03", "CC70", "BR60", "CB02", "IT30", "CZ50", "BR05", "PP20"];

function normalizeDateKey(date: string) {
  return date.slice(0, 10);
}

function compareBaseOrder(left: Base, right: Base) {
  const typeRank = (type: string) => {
    if (type === "USA") return 0;
    if (type === "CENTRAL") return 1;
    if (type === "CRL") return 2;
    return 3;
  };

  const byType = typeRank(left.type) - typeRank(right.type);
  if (byType !== 0) return byType;

  if (left.type === "USA" && right.type === "USA") {
    const leftIdx = BASE_ORDER.indexOf(left.code);
    const rightIdx = BASE_ORDER.indexOf(right.code);
    return (leftIdx === -1 ? 999 : leftIdx) - (rightIdx === -1 ? 999 : rightIdx);
  }

  return left.code.localeCompare(right.code);
}

function getDayLabel(dayOfWeek: string) {
  return DAY_LABELS[DOW_IDX[dayOfWeek as keyof typeof DOW_IDX] ?? 0];
}

function getStatusRing(a: { status: string; checkinGeoValid?: boolean | null }): string {
  if (a.status === "ABSENT") return "ring-2 ring-red-400";
  if (a.status === "CHECKED_IN" || a.status === "CHECKED_OUT") {
    return a.checkinGeoValid === false ? "ring-2 ring-sky-400" : "ring-2 ring-emerald-400";
  }
  if (a.status === "CONFIRMED") return "ring-2 ring-emerald-400";
  return "";
}

function formatDateLabel(
  dateStr: string,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit" },
) {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    ...options,
  });
}

/* ────────── Component ────────── */

export default function LeaderEscala() {
  const { data: session } = useSession();
  const { target: impersonateTarget } = useImpersonate();
  const effectiveFacultyId = impersonateTarget?.facultyId ?? session?.user?.facultyId;

  async function fetchJsonNoStore(url: string) {
    const response = await fetch(url, { cache: "no-store" });
    return response.json();
  }

  /* ── Data ── */
  const [interns, setInterns] = useState<InternRole[]>([]);
  const [bases, setBases] = useState<Base[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── Week ── */
  const [weekStart, setWeekStart] = useState(() => {
    return startOfWeekDateStr(localDateStr());
  });

  const weekDates = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStart, i)),
    [weekStart],
  );

  /* ── Filters ── */
  const [searchIntern, setSearchIntern] = useState("");
  const [filterBase, setFilterBase] = useState("");
  const [filterPeriod, setFilterPeriod] = useState<"" | "DAY" | "NIGHT">("");
  const [searchBase, setSearchBase] = useState("");

  /* ── Lottery modal ── */
  const [showLottery, setShowLottery] = useState(false);
  const [lotteryInterns, setLotteryInterns] = useState<InternRole[]>([]);
  const [lotterySelected, setLotterySelected] = useState<Set<string>>(new Set());
  const [lotteryExcluded, setLotteryExcluded] = useState<Set<string>>(new Set());
  const [lotteryLoading, setLotteryLoading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null);
  const [lotteryMsg, setLotteryMsg] = useState("");
  const [maxShifts, setMaxShifts] = useState(1);

  /* ── Manual allocation modal ── */
  const [allocSlot, setAllocSlot] = useState<{ baseId: string; baseCode: string; baseType: string; date: string; period: "DAY" | "NIGHT" } | null>(null);
  const [allocInternId, setAllocInternId] = useState("");
  const [allocSearch, setAllocSearch] = useState("");
  const [allocLoading, setAllocLoading] = useState(false);
  const [allocMsg, setAllocMsg] = useState("");
  const [allocShift, setAllocShift] = useState<"MORNING" | "AFTERNOON" | "">("");
  const [allocIsExtraShift, setAllocIsExtraShift] = useState(false);
  const [allocExtraShiftNotes, setAllocExtraShiftNotes] = useState("");

  /* ── Remove assignment (cancel) ── */
  const [removeTarget, setRemoveTarget] = useState<Assignment | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [removeError, setRemoveError] = useState("");

  /* ── CRU fixed weekly ── */
  const [cruFixed, setCruFixed] = useState<CruFixed[]>([]);
  const [cruFixedAdd, setCruFixedAdd] = useState<{ dayOfWeek: string; period: "DAY" | "NIGHT" } | null>(null);
  const [cruFixedInternId, setCruFixedInternId] = useState("");
  const [cruFixedWeeks, setCruFixedWeeks] = useState<number | null>(null);
  const [cruFixedLoading, setCruFixedLoading] = useState(false);
  const [cruFixedMsg, setCruFixedMsg] = useState("");
  const [cruGenMsg, setCruGenMsg] = useState("");
  const [cruConflictPending, setCruConflictPending] = useState<CruConflictPending | null>(null);

  /* ── Intern detail modal ── */
  const [internDetail, setInternDetail] = useState<{ id: string; name: string } | null>(null);
  const internWeekAssignments = useMemo(() => {
    if (!internDetail) return [];
    return assignments.filter(a => a.internId === internDetail.id && a.status !== "CANCELLED");
  }, [internDetail, assignments]);

  /* ── Load data ── */
  const load = useCallback(async () => {
    try {
      const from = weekDates[0];
      const to = weekDates[6];

      if (weekStart >= startOfWeekDateStr(localDateStr())) {
        await fetch("/taximetro/api/leader/cru-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weekStart }),
        }).catch(() => null);
      }

      const [uRes, bRes, aRes, sRes, cfRes] = await Promise.all([
        fetchJsonNoStore("/taximetro/api/leader/interns"),
        fetchJsonNoStore("/taximetro/api/admin/bases"),
        fetchJsonNoStore(`/taximetro/api/assignments?from=${from}&to=${to}`),
        fetchJsonNoStore(`/taximetro/api/slots/available?weekStart=${weekStart}`),
        fetchJsonNoStore("/taximetro/api/leader/cru-fixed"),
      ]);
      const [uJson, bJson, aJson, sJson, cfJson] = await Promise.all([uRes, bRes, aRes, sRes, cfRes]);
      if (uJson.success) setInterns(uJson.data);
      if (bJson.success) setBases(bJson.data.filter((b: { isActive: boolean }) => b.isActive));
      if (aJson.success) setAssignments(aJson.data);
      if (sJson.success) setSlots(sJson.data);
      if (cfJson.success) setCruFixed(cfJson.data);
    } catch {
      setLotteryMsg("❌ Erro ao carregar dados da escala.");
    }
    setLoading(false);
  }, [weekDates, weekStart]);

  useEffect(() => { load(); }, [load]);

  /* ── Derived ── */
  const sortedBases = useMemo(() => [...bases].sort(compareBaseOrder), [bases]);
  const cruBase = useMemo(() => bases.find((b) => b.type === "CENTRAL"), [bases]);
  const crlBase = useMemo(() => bases.find((b) => b.type === "CRL"), [bases]);
  const isEbmsp = useMemo(() => {
    const firstSlot = slots.find((s) => s.facultyAbbr);
    return firstSlot?.facultyAbbr === "EBMSP";
  }, [slots]);

  /* ── Vacancy matrix from slots ── */
  const vacancyByBaseDay = useMemo(() => {
    const m = new Map<string, { DAY: { cap: number; hasExtra: boolean }; NIGHT: { cap: number; hasExtra: boolean } }>();
    for (const s of slots) {
      if (!s.nextDate || !weekDates.includes(s.nextDate)) continue;
      const key = `${s.baseId}|${s.nextDate}`;
      if (!m.has(key)) m.set(key, { DAY: { cap: 0, hasExtra: false }, NIGHT: { cap: 0, hasExtra: false } });
      const entry = m.get(key)!;
      const p = s.period as "DAY" | "NIGHT";
      entry[p].cap += s.capacity;
      if (s.isExtraShift) entry[p].hasExtra = true;
    }
    return m;
  }, [slots, weekDates]);

  const assignmentsByBaseDate = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of assignments) {
      if (a.status === "CANCELLED") continue;
      const key = `${a.baseId}|${a.date}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a);
    }
    return m;
  }, [assignments]);

  const assignmentsByInternDate = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of assignments) {
      if (a.status === "CANCELLED") continue;
      const key = `${a.internId}|${a.date}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(a);
    }
    return m;
  }, [assignments]);

  const activeInterns = useMemo(
    () => interns.filter((intern) => intern.userActive && intern.roleActive && !intern.isArchived),
    [interns],
  );

  const visibleScheduleBases = useMemo(() => {
    const baseIds = new Set<string>();
    for (const slot of slots) baseIds.add(slot.baseId);
    for (const assignment of assignments) {
      if (assignment.status !== "CANCELLED") baseIds.add(assignment.baseId);
    }

    const internQuery = searchIntern.trim().toLowerCase();
    const baseQuery = searchBase.trim().toLowerCase();
    const periods = filterPeriod ? [filterPeriod] as const : PERIODS;

    return bases
      .filter((base) => baseIds.has(base.id))
      .filter((base) => !filterBase || base.id === filterBase)
      .filter((base) => !baseQuery || `${base.code} ${base.name}`.toLowerCase().includes(baseQuery))
      .filter((base) => {
        const hasVisibleContent = weekDates.some((date) => {
          const slotState = vacancyByBaseDay.get(`${base.id}|${date}`);
          const cellAssignments = (assignmentsByBaseDate.get(`${base.id}|${date}`) ?? []).filter(
            (assignment) => assignment.status !== "CANCELLED",
          );

          return periods.some((period) => {
            const periodAssignments = cellAssignments.filter((assignment) => assignment.period === period);
            const cap = slotState?.[period].cap ?? 0;
            return cap > 0 || periodAssignments.length > 0;
          });
        });

        if (!hasVisibleContent) return false;
        if (!internQuery) return true;

        return weekDates.some((date) => {
          const cellAssignments = assignmentsByBaseDate.get(`${base.id}|${date}`) ?? [];
          return cellAssignments.some((assignment) => assignment.internName.toLowerCase().includes(internQuery));
        });
      })
      .sort(compareBaseOrder);
  }, [assignments, assignmentsByBaseDate, bases, filterBase, filterPeriod, searchBase, searchIntern, slots, vacancyByBaseDay, weekDates]);

  const mainScheduleBases = useMemo(
    () => visibleScheduleBases.filter((base) => base.type === "USA"),
    [visibleScheduleBases],
  );

  /* ── Week nav ── */
  function shiftWeek(dir: number) {
    setWeekStart(addDaysToDateStr(weekStart, dir * 7));
  }

  /* ── Lottery handlers ── */
  async function openLottery() {
    setShowLottery(true);
    setLotteryLoading(true);
    setLotteryMsg("");
    setConfirmRemove(null);
    const res = await fetch("/taximetro/api/leader/interns");
    const json = await res.json();
    if (json.success) {
      setLotteryInterns(json.data.filter((i: InternRole) => !i.isArchived));
      const sel = new Set<string>();
      (json.data as InternRole[]).filter((i) => !i.isArchived).forEach((i) => { if (i.roleActive) sel.add(i.id); });
      setLotterySelected(sel);
      setLotteryExcluded(new Set());
    }
    setLotteryLoading(false);
  }

  function toggleLotteryIntern(id: string) {
    setLotterySelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleRemoveIntern(id: string, permanent: boolean) {
    try {
      if (permanent) {
        await fetch("/taximetro/api/leader/interns", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: id, action: "deactivate" }),
        });
        setLotteryInterns((prev) =>
          prev.map((i) => (i.id === id ? { ...i, roleActive: false } : i)),
        );
      } else {
        setLotteryExcluded((prev) => new Set(prev).add(id));
      }
      setLotterySelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
      setConfirmRemove(null);
    } catch {
      setLotteryMsg("❌ Erro ao remover interno.");
    }
  }

  async function handleReactivateIntern(id: string) {
    try {
      await fetch("/taximetro/api/leader/interns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: id, action: "reactivate" }),
      });
      setLotteryInterns((prev) =>
        prev.map((i) => (i.id === id ? { ...i, roleActive: true } : i)),
      );
      setLotterySelected((prev) => new Set(prev).add(id));
    } catch {
      setLotteryMsg("❌ Erro ao reativar interno.");
    }
  }

  async function runLottery() {
    setLotteryLoading(true);
    setLotteryMsg("");
    const ids = [...lotterySelected].filter((id) => !lotteryExcluded.has(id));

    const atCapCount = ids.filter((id) => (lotteryShiftsByIntern.get(id) ?? 0) >= maxShifts).length;
    if (atCapCount === ids.length) {
      const suggestion = maxShifts < 3
        ? `Aumente para ${maxShifts + 1} plantões em USA por interno e tente novamente.`
        : "Reduza os selecionados ou remova plantões em USA já existentes para liberar vagas.";
      setLotteryMsg(
        `⚠️ Nenhuma alocação possível com limite ${maxShifts}: todos os ${ids.length} selecionados já têm ${maxShifts} ou mais plantões em USA nesta semana. ${suggestion}`,
      );
      setLotteryLoading(false);
      return;
    }

    const res = await fetch("/taximetro/api/leader/lottery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart, internIds: ids, maxShifts }),
    });
    const json = await res.json();
    if (json.success) {
      const d = json.data;
      const internNameById = new Map(lotteryInterns.map((intern) => [intern.id, intern.name]));
      const unallocatedList = (d.unallocatedInterns ?? []) as Array<{ internId: string; reasonLabel: string }>;
      const unallocatedMsg = unallocatedList.length > 0
        ? ` · Não alocados: ${unallocatedList
          .slice(0, 5)
          .map((item) => `${internNameById.get(item.internId) ?? item.internId} (${item.reasonLabel})`)
          .join(", ")}${unallocatedList.length > 5 ? " ..." : ""}`
        : "";
      setLotteryMsg(
        `✅ ${d.total} alocações criadas — ${d.internsAllocated}/${d.internsTotal} internos alocados` +
        (d.remainingPositions > 0 ? ` · ${d.remainingPositions} vagas remanescentes` : " · Sem vagas remanescentes") +
        unallocatedMsg
      );
      await load();
    } else {
      setLotteryMsg(`❌ ${json.error}`);
    }
    setLotteryLoading(false);
  }

  /* ── Manual allocation ── */
  function openAllocModal(baseId: string, baseCode: string, baseType: string, date: string, period: "DAY" | "NIGHT", isExtra?: boolean) {
    setAllocSlot({ baseId, baseCode, baseType, date, period });
    setAllocInternId("");
    setAllocSearch("");
    setAllocMsg("");
    setAllocIsExtraShift(isExtra ?? false);
    setAllocExtraShiftNotes("");
    const isCruShift = isEbmsp && baseType === "CENTRAL" && period === "DAY";
    setAllocShift(isCruShift ? "MORNING" : "");
  }

  async function submitAllocation() {
    if (!allocSlot || !allocInternId || !effectiveFacultyId) return;
    const isCruShift = isEbmsp && allocSlot.baseType === "CENTRAL" && allocSlot.period === "DAY";
    if (isCruShift && !allocShift) {
      setAllocMsg("❌ Selecione o turno (Manhã ou Tarde) para CRU.");
      return;
    }
    setAllocLoading(true);
    setAllocMsg("");
    try {
      const res = await fetch("/taximetro/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          internId: allocInternId,
          facultyId: effectiveFacultyId,
          baseId: allocSlot.baseId,
          date: allocSlot.date,
          period: allocSlot.period,
          ...(allocShift ? { shift: allocShift } : {}),
          ...(allocIsExtraShift ? { isExtraShift: true, extraShiftNotes: allocExtraShiftNotes || undefined } : {}),
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      const json = contentType.includes("application/json") ? await res.json() : null;

      if (json.success) {
        setAllocMsg(json.reusedCancelled ? "✅ Plantão cancelado reativado com sucesso!" : "✅ Alocado com sucesso!");
        await load();
        setTimeout(() => setAllocSlot(null), 800);
      } else {
        const fallback = res.ok
          ? "Falha ao processar a alocação."
          : `Falha ao processar a alocação (HTTP ${res.status}).`;
        setAllocMsg(`❌ ${json?.error ?? fallback}`);
      }
    } catch (error) {
      setAllocMsg(`❌ ${error instanceof Error ? error.message : "Falha ao processar a alocação."}`);
    }
    setAllocLoading(false);
  }

  /* ── Remove assignment handler ── */
  async function confirmRemoveAssignment() {
    if (!removeTarget) return;
    setRemoveLoading(true);
    setRemoveError("");
    try {
      const res = await fetch("/taximetro/api/assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: removeTarget.id,
          status: "CANCELLED",
          notes: `Removido da escala pelo líder em ${formatDateLabel(localDateStr(), { day: "2-digit", month: "2-digit", year: "numeric" })}`,
        }),
      });
      const contentType = res.headers.get("content-type") ?? "";
      const json = contentType.includes("application/json") ? await res.json() : null;
      if (json.success) {
        await load();
        setRemoveTarget(null);
      } else {
        const fallback = res.ok
          ? "Não foi possível remover este plantão."
          : `Falha ao remover plantão (HTTP ${res.status}).`;
        setRemoveError(json?.error ?? fallback);
      }
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : "Erro de conexão ao remover plantão.");
    }
    setRemoveLoading(false);
  }

  /* ── CRU fixed handlers ── */
  async function addCruFixed() {
    if (!cruFixedAdd || !cruFixedInternId || !cruFixedWeeks) return;
    const selectedWeeks = cruFixedWeeks;
    setCruFixedLoading(true);
    setCruFixedMsg("");
    try {
      const res = await fetch("/taximetro/api/leader/cru-fixed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          internId: cruFixedInternId,
          dayOfWeek: cruFixedAdd.dayOfWeek,
          period: cruFixedAdd.period,
          weeks: selectedWeeks,
        }),
      });
      const json = await res.json();
      if (json.success) {
        const sync = json.data;
        const forceable: CruConflictItem[] = (sync?.skipped ?? [])
          .filter((s: { canForce?: boolean }) => s.canForce)
          .map((s: { assignmentId: string; baseCode: string; date: string; period: "DAY" | "NIGHT"; status: string; internName: string }) => ({
            assignmentId: s.assignmentId,
            baseCode: s.baseCode,
            date: s.date,
            period: s.period,
            status: s.status,
            internName: s.internName,
          }));
        await load();
        if (forceable.length > 0) {
          const changed = (sync?.createdCount ?? 0) + (sync?.updatedCount ?? 0) + (sync?.reactivatedCount ?? 0);
          setCruFixedMsg(`⚠️ ${changed} alocado(s) — ${forceable.length} conflito(s) com intervenção`);
          setCruConflictPending({
            internId: cruFixedInternId,
            dayOfWeek: cruFixedAdd.dayOfWeek,
            period: cruFixedAdd.period,
            weeks: selectedWeeks,
            conflicts: forceable,
          });
        } else {
          const changed = (sync?.createdCount ?? 0) + (sync?.updatedCount ?? 0) + (sync?.reactivatedCount ?? 0);
          setCruFixedMsg(`✅ Salvo e sincronizado (${changed}/${sync?.plannedCount ?? 0})`);
          setTimeout(() => { setCruFixedAdd(null); setCruFixedMsg(""); }, 600);
        }
      } else {
        setCruFixedMsg(`❌ ${json.error}`);
      }
    } catch {
      setCruFixedMsg("❌ Erro de conexão.");
    }
    setCruFixedLoading(false);
  }

  async function forceCruFixed() {
    if (!cruConflictPending) return;
    setCruFixedLoading(true);
    try {
      const res = await fetch("/taximetro/api/leader/cru-fixed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          internId: cruConflictPending.internId,
          dayOfWeek: cruConflictPending.dayOfWeek,
          period: cruConflictPending.period,
          weeks: cruConflictPending.weeks,
          forceConflictIds: cruConflictPending.conflicts.map((c) => c.assignmentId),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setCruConflictPending(null);
        setCruFixedAdd(null);
        setCruFixedMsg("");
        await load();
      } else {
        setCruFixedMsg(`❌ ${json.error}`);
        setCruConflictPending(null);
      }
    } catch {
      setCruFixedMsg("❌ Erro de conexão.");
    }
    setCruFixedLoading(false);
  }

  async function removeCruFixed(id: string) {
    try {
      const res = await fetch(`/taximetro/api/leader/cru-fixed?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        const cancelled = json.data?.cancelledCount ?? 0;
        const alreadyCancelled = json.data?.alreadyCancelledCount ?? 0;
        setCruGenMsg(`✅ Template removido. ${cancelled} plantão(ões) futuro(s) cancelado(s)${alreadyCancelled > 0 ? ` · ${alreadyCancelled} já estavam cancelados` : ""}`);
      }
      await load();
    } catch { /* silent */ }
  }

  async function generateCruWeek() {
    setCruGenMsg("");
    try {
      const res = await fetch("/taximetro/api/leader/cru-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart }),
      });
      const json = await res.json();
      if (json.success) {
        setCruGenMsg(`✅ ${json.created} criados · ${json.updated ?? 0} movidos · ${json.reactivated ?? 0} reativados · ${json.total} previstos`);
        await load();
      } else {
        setCruGenMsg(`❌ ${json.error}`);
      }
    } catch {
      setCruGenMsg("❌ Erro de conexão.");
    }
  }

  /* ── CRU/CRL ±12h conflict detection (client-side) ── */
  const cruConflicts = useMemo(() => {
    // Map: "internId|date|period" → true if that slot is blocked by a CRU/CRL assignment
    const blocked = new Set<string>();
    for (const a of assignments) {
      if (a.status === "CANCELLED" || (a.baseCode !== "CRU" && a.baseCode !== "CRL")) continue;
      const dateKey = normalizeDateKey(a.date);
      // The CRU assignment itself is fine — mark adjacent slots as blocked
      if (a.period === "DAY") {
        blocked.add(`${a.internId}|${addDaysToDateStr(dateKey, -1)}|NIGHT`);
        blocked.add(`${a.internId}|${dateKey}|NIGHT`);
      } else {
        blocked.add(`${a.internId}|${dateKey}|DAY`);
        blocked.add(`${a.internId}|${addDaysToDateStr(dateKey, 1)}|DAY`);
      }
    }
    return blocked;
  }, [assignments]);

  const allocationCandidates = useMemo(() => {
    if (!allocSlot) {
      return {
        eligibleInterns: [] as InternRole[],
        blockedCount: 0,
        busyCount: 0,
      };
    }

    const query = allocSearch.trim().toLowerCase();
    let blockedCount = 0;
    let busyCount = 0;

    const eligibleInterns = activeInterns
      .filter((intern) => {
        const key = `${intern.id}|${allocSlot.date}`;
        const existing = assignmentsByInternDate.get(key) ?? [];

        // For CRU DAY with shift: only block CRU if same shift; still block non-CRU same-period
        const isCruShift = isEbmsp && allocSlot.baseType === "CENTRAL" && allocSlot.period === "DAY" && Boolean(allocShift);
        const busy = existing.some((assignment) => {
          if (assignment.period !== allocSlot.period) return false;
          if (isCruShift && assignment.baseType === "CENTRAL") {
            return assignment.shift === allocShift;
          }
          return true;
        });
        if (busy) {
          busyCount += 1;
          return false;
        }

        // CRU/CRL targets are exempt from ±12h conflict (only blocks USA)
        const isTargetCru = allocSlot.baseType === "CENTRAL" || allocSlot.baseCode === "CRL";
        if (!isTargetCru && cruConflicts.has(`${intern.id}|${allocSlot.date}|${allocSlot.period}`)) {
          blockedCount += 1;
          return false;
        }

        if (query && !intern.name.toLowerCase().includes(query)) {
          return false;
        }

        return true;
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    return { eligibleInterns, blockedCount, busyCount };
  }, [activeInterns, allocSearch, allocShift, allocSlot, assignmentsByInternDate, cruConflicts, isEbmsp]);

  const today = localDateStr();
  const selectedLotteryIds = [...lotterySelected].filter((id) => !lotteryExcluded.has(id));
  const selectedCount = selectedLotteryIds.length;
  const lotteryShiftsByIntern = assignments.reduce((acc, assignment) => {
    if (assignment.status === "CANCELLED") return acc;
    if (assignment.baseType !== "USA") return acc;
    acc.set(assignment.internId, (acc.get(assignment.internId) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());
  const selectedAtCapCount = selectedLotteryIds.filter(
    (id) => (lotteryShiftsByIntern.get(id) ?? 0) >= maxShifts,
  ).length;

  if (loading) return <p className="p-8 text-slate-400">Carregando...</p>;

  return (
    <div className="space-y-8">
      {/* ═══════════ Header ═══════════ */}
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Montar Escala</h1>
        <div className="flex-1" />
        <button
          onClick={openLottery}
          className="relative rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 px-7 py-3.5 text-base font-extrabold text-white shadow-[0_6px_20px_rgba(16,185,129,0.4)] transition hover:shadow-[0_8px_30px_rgba(16,185,129,0.5)] hover:-translate-y-0.5 active:translate-y-0 active:shadow-[0_2px_8px_rgba(16,185,129,0.3)]"
        >
          <span className="flex items-center gap-2">
            <Dices className="h-6 w-6" /> SORTEAR
          </span>
        </button>
      </div>

      {/* Week navigation */}
      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={() => shiftWeek(-1)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 flex items-center gap-1">
          <ChevronLeft className="h-4 w-4" /> Anterior
        </button>
        <span className="text-sm font-semibold text-slate-700">
          Semana de {formatDateLabel(weekStart, { day: "2-digit", month: "2-digit", year: "numeric" })}
        </span>
        <button onClick={() => shiftWeek(1)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200 flex items-center gap-1">
          Próxima <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* ═══════════ Planilha Única da Semana ═══════════ */}
      <section className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full bg-accent-500" />
            Planilha Única da Semana
          </h2>
          <span className="text-xs text-slate-500">
            Cada célula representa a vaga da sua faculdade nas bases USA. Quando há interno escalado, o nome aparece; quando sobra vaga, a célula fica como vaga disponível.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <Filter className="h-4 w-4 text-slate-400" />
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar interno..."
              value={searchIntern}
              onChange={(e) => setSearchIntern(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-sm w-44 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
            />
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar base..."
              value={searchBase}
              onChange={(e) => setSearchBase(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-sm w-44 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
            />
          </div>
          <select
            value={filterBase}
            onChange={(e) => setFilterBase(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          >
            <option value="">Todas as bases</option>
            {sortedBases.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
          <select
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value as "" | "DAY" | "NIGHT")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          >
            <option value="">Todos os turnos</option>
            <option value="DAY">☀️ Diurno</option>
            <option value="NIGHT">🌙 Noturno</option>
          </select>
          <span className="ml-auto text-xs text-slate-400">{mainScheduleBases.length} bases visíveis</span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="min-w-[1180px]" style={{ display: "grid", gridTemplateColumns: "150px repeat(7, minmax(146px, 1fr))" }}>
            <div className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
              Base
            </div>
            {weekDates.map((d, i) => (
              <div
                key={d}
                className={`border-b border-slate-200 px-2 py-2 text-center text-xs font-semibold ${d === today ? "bg-accent-50/50 text-accent-700" : "bg-slate-50 text-slate-500"}`}
              >
                {DAY_LABELS[i]}<br /><span className="font-normal">{d.slice(5)}</span>
              </div>
            ))}

            {mainScheduleBases.map((base) => {
              const baseStyle = getBaseStyle(base.type);
              return (
                <Fragment key={`schedule-${base.id}`}>
                  <div className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{base.code}</span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${baseStyle.pill}`}>
                        {baseStyle.label}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{base.name}</p>
                  </div>

                  {weekDates.map((d) => {
                    const slotState = vacancyByBaseDay.get(`${base.id}|${d}`);
                    const cellAssignments = (assignmentsByBaseDate.get(`${base.id}|${d}`) ?? []).filter((assignment) => assignment.status !== "CANCELLED");
                    const periods = filterPeriod ? [filterPeriod] as const : PERIODS;
                    const periodBlocks = periods.map((period) => {
                      const periodAssignments = cellAssignments
                        .filter((assignment) => assignment.period === period)
                        .sort((left, right) => left.internName.localeCompare(right.internName));
                      const capacity = slotState?.[period].cap ?? 0;
                      const openCount = Math.max(capacity - periodAssignments.length, 0);

                      if (capacity === 0 && periodAssignments.length === 0) return null;

                      const periodStyle = getPeriodStyle(period);
                      const containerStyle = capacity === 0
                        ? "border-rose-200 bg-rose-50/60"
                        : openCount > 0
                          ? "border-amber-200 bg-amber-50/60"
                          : "border-emerald-200 bg-emerald-50/50";

                      return (
                        <div key={`${base.id}|${d}|${period}`} className={`rounded-lg border p-1.5 ${containerStyle}`}>
                          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            <span className="flex items-center gap-1">{periodStyle.emoji} {periodStyle.label}</span>
                            <span>{periodAssignments.length}/{capacity || periodAssignments.length}</span>
                          </div>

                          <div className="space-y-1">
                            {periodAssignments.map((assignment) => {
                              const ring = getStatusRing(assignment);
                              const isCruBlocked = cruConflicts.has(`${assignment.internId}|${normalizeDateKey(assignment.date)}|${assignment.period}`);
                              const isExtra = assignment.isExtraShift;
                              return (
                                <div
                                  key={assignment.id}
                                  onClick={() => setInternDetail({ id: assignment.internId, name: assignment.internName })}
                                  className={`group relative rounded-md px-2 py-1 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition hover:opacity-80 ${periodStyle.bg} ${periodStyle.text} ${ring} ${isCruBlocked ? "ring-2 ring-red-500 bg-red-50" : ""} ${isExtra ? "extra-shift-card" : ""}`}
                                  title={`${assignment.internName} · ${assignment.status}${assignment.shift ? ` · ${assignment.shift === "MORNING" ? "Manhã" : "Tarde"}` : ""}${capacity === 0 ? " · sem vaga configurada" : ""}${isCruBlocked ? " · conflito CRU ±12h" : ""}${isExtra ? " · Plantão Extra" : ""}`}
                                  style={isExtra ? { boxShadow: "0 0 6px 1px rgba(99,102,241,0.5)" } : undefined}
                                >
                                  {isExtra && <span className="pointer-events-none absolute inset-0 extra-shift-shimmer rounded-md" />}
                                  {isExtra && <span className="text-[8px] font-bold text-indigo-700 shrink-0">EX</span>}
                                  {isCruBlocked && <span className="text-red-600 text-[10px]">⚠️</span>}
                                  {assignment.shift && <span className="text-[9px] font-bold shrink-0">{assignment.shift === "MORNING" ? "M" : "T"}</span>}
                                  <span className="truncate">{assignment.internName.split(" ").slice(0, 2).join(" ")}</span>
                                  {assignment.status === "SCHEDULED" && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setRemoveError(""); setRemoveTarget(assignment); }}
                                      className="ml-auto hidden h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500/80 text-white transition hover:bg-red-600 group-hover:flex"
                                      title="Remover da escala"
                                    >
                                      <X className="h-2.5 w-2.5" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}

                            {Array.from({ length: openCount }, (_, vacancyIndex) => (
                              <button
                                key={`${base.id}|${d}|${period}|vacancy-${vacancyIndex + 1}`}
                                onClick={() => openAllocModal(base.id, base.code, base.type, d, period, slotState?.[period].hasExtra)}
                                className="flex w-full items-center gap-2 rounded-md border border-dashed border-amber-300 bg-white/90 px-2 py-1 text-left text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100"
                              >
                                <Plus className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">Vago</span>
                                {openCount > 1 && (
                                  <span className="ml-auto shrink-0 text-[10px] text-amber-600">
                                    {vacancyIndex + 1}/{openCount}
                                  </span>
                                )}
                              </button>
                            ))}

                            {capacity === 0 && periodAssignments.length > 0 && (
                              <p className="rounded-md bg-white/70 px-2 py-1 text-[10px] font-medium text-rose-700">
                                Plantão preservado sem regra ativa de vaga.
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    }).filter(Boolean);

                    return (
                      <div
                        key={`${base.id}|${d}`}
                        className={`border-b border-slate-100 px-2 py-2 min-h-[132px] ${d === today ? "bg-accent-50/20" : ""}`}
                      >
                        <div className="space-y-1.5">
                          {periodBlocks.length > 0 ? periodBlocks : <span className="text-xs italic text-slate-300">—</span>}
                        </div>
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══════════ CRL — Regulação de Leitos ═══════════ */}
      {crlBase && (
        <section className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-lg font-semibold text-rose-700 flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full bg-rose-500" />
              CRL — Regulação de Leitos (SUREM)
            </h2>
            <span className="text-xs text-slate-500">
              A CRL continua separada da planilha principal para não misturar a régua específica de regulação com as bases USA.
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-rose-200 bg-white shadow-sm">
            <div className="min-w-[980px]" style={{ display: "grid", gridTemplateColumns: "140px repeat(7, minmax(118px, 1fr))" }}>
              <div className="sticky left-0 z-10 border-b border-r border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                Base
              </div>
              {weekDates.map((d, i) => (
                <div
                  key={`crl-head-${d}`}
                  className={`border-b border-rose-200 px-2 py-2 text-center text-xs font-semibold ${d === today ? "bg-rose-50/80 text-rose-700" : "bg-rose-50/40 text-slate-500"}`}
                >
                  {DAY_LABELS[i]}<br /><span className="font-normal">{d.slice(5)}</span>
                </div>
              ))}

              <div className="sticky left-0 z-10 border-b border-r border-rose-100 bg-white px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">{crlBase.code}</span>
                  <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-600/20">
                    CRL
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">{crlBase.name}</p>
              </div>

              {weekDates.map((d) => {
                const slotState = vacancyByBaseDay.get(`${crlBase.id}|${d}`);
                const cellAssignments = (assignmentsByBaseDate.get(`${crlBase.id}|${d}`) ?? [])
                  .filter((assignment) => assignment.status !== "CANCELLED")
                  .sort((left, right) => left.internName.localeCompare(right.internName));
                const dayCapacity = slotState?.DAY.cap ?? 0;
                const openCount = Math.max(dayCapacity - cellAssignments.filter((assignment) => assignment.period === "DAY").length, 0);

                return (
                  <div
                    key={`crl-cell-${d}`}
                    className={`border-b border-rose-50 px-2 py-2 min-h-[110px] ${d === today ? "bg-rose-50/20" : ""}`}
                  >
                    <div className="space-y-1.5">
                      {cellAssignments.length === 0 && dayCapacity === 0 && (
                        <span className="text-xs italic text-slate-300">—</span>
                      )}

                      {(cellAssignments.length > 0 || dayCapacity > 0) && (
                        <div className={`rounded-lg border p-1.5 ${openCount > 0 ? "border-amber-200 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/50"}`}>
                          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            <span className="flex items-center gap-1">☀️ Diurno</span>
                            <span>{cellAssignments.filter((assignment) => assignment.period === "DAY").length}/{dayCapacity || cellAssignments.length}</span>
                          </div>

                          <div className="space-y-1">
                            {cellAssignments.map((assignment) => {
                              const ring = getStatusRing(assignment);
                              const isExtra = assignment.isExtraShift;
                              return (
                                <div
                                  key={assignment.id}
                                  onClick={() => setInternDetail({ id: assignment.internId, name: assignment.internName })}
                                  className={`group relative flex cursor-pointer items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 transition hover:opacity-80 ${ring} ${isExtra ? "extra-shift-card" : ""}`}
                                  title={`${assignment.internName} · ${assignment.status}${isExtra ? " · Plantão Extra" : ""}`}
                                  style={isExtra ? { boxShadow: "0 0 6px 1px rgba(99,102,241,0.5)" } : undefined}
                                >
                                  {isExtra && <span className="pointer-events-none absolute inset-0 extra-shift-shimmer rounded-md" />}
                                  {isExtra && <span className="text-[8px] font-bold text-indigo-700 shrink-0">EX</span>}
                                  <span className="truncate">{assignment.internName.split(" ").slice(0, 2).join(" ")}</span>
                                  {assignment.status === "SCHEDULED" && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setRemoveError(""); setRemoveTarget(assignment); }}
                                      className="ml-auto hidden h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500/80 text-white transition hover:bg-red-600 group-hover:flex"
                                      title="Remover da escala"
                                    >
                                      <X className="h-2.5 w-2.5" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}

                            {openCount > 0 && (!filterPeriod || filterPeriod === "DAY") && (
                              <button
                                onClick={() => openAllocModal(crlBase.id, crlBase.code, crlBase.type, d, "DAY", slotState?.DAY.hasExtra)}
                                className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-amber-300 bg-white/80 px-2 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                {openCount === 1 ? "Vaga disponível" : `${openCount} vagas disponíveis`}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ═══════════ CRU — Central de Regulação de Urgência ═══════════ */}
      {cruBase && (
        <section className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-lg font-semibold text-violet-700 flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full bg-violet-500" />
              CRU — Central de Regulação de Urgência
            </h2>
            <span className="text-xs text-slate-500">
              {isEbmsp ? "Alocação por turno: Manhã (07h–13h) ou Tarde (13h–19h)." : "Central de Regulação de Urgência."}
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-violet-200 bg-white shadow-sm">
            <div className="min-w-[980px]" style={{ display: "grid", gridTemplateColumns: "140px repeat(7, minmax(118px, 1fr))" }}>
              <div className="sticky left-0 z-10 border-b border-r border-violet-200 bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700">
                Base
              </div>
              {weekDates.map((d, i) => (
                <div
                  key={`cru-head-${d}`}
                  className={`border-b border-violet-200 px-2 py-2 text-center text-xs font-semibold ${d === today ? "bg-violet-50/80 text-violet-700" : "bg-violet-50/40 text-slate-500"}`}
                >
                  {DAY_LABELS[i]}<br /><span className="font-normal">{d.slice(5)}</span>
                </div>
              ))}

              <div className="sticky left-0 z-10 border-b border-r border-violet-100 bg-white px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">{cruBase.code}</span>
                  <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-600/20">
                    CRU
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">{cruBase.name}</p>
              </div>

              {weekDates.map((d) => {
                const slotState = vacancyByBaseDay.get(`${cruBase.id}|${d}`);
                const cellAssignments = (assignmentsByBaseDate.get(`${cruBase.id}|${d}`) ?? [])
                  .filter((a) => a.status !== "CANCELLED");
                const periods = filterPeriod ? [filterPeriod] as const : PERIODS;
                const periodBlocks = periods.map((period) => {
                  const periodAssignments = cellAssignments
                    .filter((a) => a.period === period)
                    .sort((a, b) => a.internName.localeCompare(b.internName));
                  const capacity = slotState?.[period].cap ?? 0;
                  const openCount = Math.max(capacity - periodAssignments.length, 0);

                  if (capacity === 0 && periodAssignments.length === 0) return null;

                  const periodStyle = getPeriodStyle(period);
                  const containerStyle = capacity === 0
                    ? "border-rose-200 bg-rose-50/60"
                    : openCount > 0
                      ? "border-amber-200 bg-amber-50/60"
                      : "border-emerald-200 bg-emerald-50/50";

                  return (
                    <div key={`${cruBase.id}|${d}|${period}`} className={`rounded-lg border p-1.5 ${containerStyle}`}>
                      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        <span className="flex items-center gap-1">{periodStyle.emoji} {periodStyle.label}</span>
                        <span>{periodAssignments.length}/{capacity || periodAssignments.length}</span>
                      </div>

                      <div className="space-y-1">
                        {periodAssignments.map((assignment) => {
                          const ring = getStatusRing(assignment);
                          const isExtra = assignment.isExtraShift;
                          return (
                            <div
                              key={assignment.id}
                              onClick={() => setInternDetail({ id: assignment.internId, name: assignment.internName })}
                              className={`group relative flex cursor-pointer items-center gap-1 rounded-md bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700 transition hover:opacity-80 ${ring} ${isExtra ? "extra-shift-card" : ""}`}
                              title={`${assignment.internName} · ${assignment.status}${assignment.shift ? ` · ${assignment.shift === "MORNING" ? "Manhã" : "Tarde"}` : ""}${isExtra ? " · Plantão Extra" : ""}`}
                              style={isExtra ? { boxShadow: "0 0 6px 1px rgba(99,102,241,0.5)" } : undefined}
                            >
                              {isExtra && <span className="pointer-events-none absolute inset-0 extra-shift-shimmer rounded-md" />}
                              {isExtra && <span className="text-[8px] font-bold text-indigo-700 shrink-0">EX</span>}
                              {assignment.shift && <span className="text-[9px] font-bold shrink-0">{assignment.shift === "MORNING" ? "M" : "T"}</span>}
                              <span className="truncate">{assignment.internName.split(" ").slice(0, 2).join(" ")}</span>
                              {assignment.status === "SCHEDULED" && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setRemoveError(""); setRemoveTarget(assignment); }}
                                  className="ml-auto hidden h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500/80 text-white transition hover:bg-red-600 group-hover:flex"
                                  title="Remover da escala"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              )}
                            </div>
                          );
                        })}

                        {openCount > 0 && (
                          <button
                            onClick={() => openAllocModal(cruBase.id, cruBase.code, cruBase.type, d, period, slotState?.[period].hasExtra)}
                            className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-amber-300 bg-white/80 px-2 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            {openCount === 1 ? "Vaga disponível" : `${openCount} vagas`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }).filter(Boolean);

                return (
                  <div
                    key={`cru-cell-${d}`}
                    className={`border-b border-violet-50 px-2 py-2 min-h-[110px] ${d === today ? "bg-violet-50/20" : ""}`}
                  >
                    <div className="space-y-1.5">
                      {periodBlocks.length > 0 ? periodBlocks : <span className="text-xs italic text-slate-300">—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ═══════════ CRU Fixo Semanal ═══════════ */}
      {cruBase && (
        <section className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-lg font-semibold text-violet-700 flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full bg-violet-500" />
              CRU — Fixos Semanais
            </h2>
            <button
              onClick={generateCruWeek}
              className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-violet-700 transition shadow-sm"
            >
              Gerar assignments da CRU nesta semana
            </button>
            {cruGenMsg && <span className="text-sm">{cruGenMsg}</span>}
          </div>
          <p className="text-xs text-slate-500">
            Os fixos da CRU ficam cadastrados aqui, mas só viram assignments reais quando você clicar no botão acima. O número ao lado do nome mostra semanas restantes.
          </p>

          <div className="overflow-x-auto rounded-xl border border-violet-200 bg-white shadow-sm">
            <div
              className="min-w-[700px]"
              style={{ display: "grid", gridTemplateColumns: "70px repeat(7, 1fr)" }}
            >
              {/* Header */}
              <div className="bg-violet-50 border-b border-r border-violet-200 px-2 py-2 text-xs font-semibold text-violet-600">
                Turno
              </div>
              {DAY_LABELS.map((lbl, i) => (
                <div key={lbl} className="bg-violet-50 border-b border-violet-200 px-2 py-2 text-center text-xs font-semibold text-violet-600">
                  {lbl}
                </div>
              ))}

              {/* DAY row */}
              <div className="bg-white border-b border-r border-violet-100 px-2 py-2 text-xs font-bold text-amber-600 flex items-center">
                ☀️ Dia
              </div>
              {(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const).map((dow) => {
                const cell = cruFixed.filter((c) => c.day_of_week === dow && c.period === "DAY");
                return (
                  <div key={`day-${dow}`} className="border-b border-violet-50 px-1 py-1 min-h-[44px]">
                    {cell.map((c) => {
                      // Calculate weeks remaining using date-only comparison (no timezone issues)
                      const validUntilDate = new Date(c.valid_until + "T00:00:00Z");
                      const todayDate = new Date(localDateStr() + "T00:00:00Z");
                      const daysRemaining = Math.floor((validUntilDate.getTime() - todayDate.getTime()) / (86400000));
                      const weeksLeft = Math.max(0, Math.ceil((daysRemaining + 1) / 7));
                      return (
                        <div key={c.id} className="group rounded-md bg-amber-50 text-amber-800 px-1.5 py-0.5 text-[11px] font-medium mb-0.5 flex items-center gap-1">
                          <span className="truncate">{c.intern_name.split(" ").slice(0, 2).join(" ")}</span>
                          <span className="text-[9px] text-amber-500 shrink-0">{weeksLeft}s</span>
                          <button
                            onClick={() => removeCruFixed(c.id)}
                            className="ml-auto hidden group-hover:flex shrink-0 items-center justify-center rounded-full h-4 w-4 bg-red-500/80 text-white hover:bg-red-600 transition"
                            title="Remover fixo"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      onClick={() => { setCruFixedAdd({ dayOfWeek: dow, period: "DAY" }); setCruFixedInternId(""); setCruFixedWeeks(null); setCruFixedMsg(""); }}
                      className="rounded px-1 py-0.5 text-[10px] text-violet-400 hover:bg-violet-50 hover:text-violet-600 transition w-full flex items-center justify-center gap-0.5"
                    >
                      <Plus className="h-3 w-3" /> Adicionar
                    </button>
                  </div>
                );
              })}

              {/* NIGHT row */}
              <div className="bg-white border-b border-r border-violet-100 px-2 py-2 text-xs font-bold text-indigo-600 flex items-center">
                🌙 Noite
              </div>
              {(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const).map((dow) => {
                const cell = cruFixed.filter((c) => c.day_of_week === dow && c.period === "NIGHT");
                return (
                  <div key={`night-${dow}`} className="border-b border-violet-50 px-1 py-1 min-h-[44px]">
                    {cell.map((c) => {
                      // Calculate weeks remaining using date-only comparison (no timezone issues)
                      const validUntilDate = new Date(c.valid_until + "T00:00:00Z");
                      const todayDate = new Date(localDateStr() + "T00:00:00Z");
                      const daysRemaining = Math.floor((validUntilDate.getTime() - todayDate.getTime()) / (86400000));
                      const weeksLeft = Math.max(0, Math.ceil((daysRemaining + 1) / 7));
                      return (
                        <div key={c.id} className="group rounded-md bg-indigo-50 text-indigo-800 px-1.5 py-0.5 text-[11px] font-medium mb-0.5 flex items-center gap-1">
                          <span className="truncate">{c.intern_name.split(" ").slice(0, 2).join(" ")}</span>
                          <span className="text-[9px] text-indigo-500 shrink-0">{weeksLeft}s</span>
                          <button
                            onClick={() => removeCruFixed(c.id)}
                            className="ml-auto hidden group-hover:flex shrink-0 items-center justify-center rounded-full h-4 w-4 bg-red-500/80 text-white hover:bg-red-600 transition"
                            title="Remover fixo"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      onClick={() => { setCruFixedAdd({ dayOfWeek: dow, period: "NIGHT" }); setCruFixedInternId(""); setCruFixedWeeks(null); setCruFixedMsg(""); }}
                      className="rounded px-1 py-0.5 text-[10px] text-violet-400 hover:bg-violet-50 hover:text-violet-600 transition w-full flex items-center justify-center gap-0.5"
                    >
                      <Plus className="h-3 w-3" /> Adicionar
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ═══════════ Lottery Modal ═══════════ */}
      {showLottery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-4 text-white flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Dices className="h-5 w-5" /> Sortear Internos
                </h2>
                <p className="text-sm text-emerald-100">
                  Semana de {formatDateLabel(weekStart, { day: "2-digit", month: "2-digit", year: "numeric" })}
                </p>
              </div>
              <button onClick={() => setShowLottery(false)} className="rounded-lg p-1.5 hover:bg-white/20 transition">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Intern list */}
            <div className="px-6 py-4 max-h-[400px] overflow-y-auto space-y-1">
              {lotteryLoading ? (
                <p className="text-slate-400 text-sm py-4 text-center">Carregando internos...</p>
              ) : (
                <>
                  {lotteryInterns.filter((i) => i.roleActive).map((intern) => {
                    const selected = lotterySelected.has(intern.id);
                    const excluded = lotteryExcluded.has(intern.id);
                    return (
                      <div
                        key={intern.id}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 transition ${excluded ? "bg-slate-50 opacity-50" : selected ? "bg-emerald-50/70" : "bg-slate-50"
                          }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected && !excluded}
                          onChange={() => toggleLotteryIntern(intern.id)}
                          disabled={excluded}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span className={`flex-1 text-sm font-medium ${excluded ? "line-through text-slate-400" : "text-slate-800"}`}>
                          {intern.name}
                        </span>
                        {excluded ? (
                          <span className="text-[11px] text-slate-400 italic">excluído</span>
                        ) : (
                          <button
                            onClick={() => setConfirmRemove({ id: intern.id, name: intern.name })}
                            className="rounded p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                            title="Remover"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {/* Inactive interns */}
                  {lotteryInterns.some((i) => !i.roleActive) && (
                    <>
                      <div className="border-t border-slate-200 mt-3 pt-3">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Inativos</p>
                      </div>
                      {lotteryInterns.filter((i) => !i.roleActive).map((intern) => (
                        <div key={intern.id} className="flex items-center gap-3 rounded-lg px-3 py-2 bg-slate-50/50 opacity-60">
                          <UserX className="h-4 w-4 text-slate-400" />
                          <span className="flex-1 text-sm text-slate-500 line-through">{intern.name}</span>
                          <button
                            onClick={() => handleReactivateIntern(intern.id)}
                            className="rounded px-2 py-1 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 transition flex items-center gap-1"
                            title="Restaurar"
                          >
                            <RotateCcw className="h-3 w-3" />Restaurar
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>

            {/* Inline confirmation */}
            {confirmRemove && (
              <div className="mx-6 mb-2 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                <p className="text-sm text-amber-800 font-medium">
                  Remover <strong>{confirmRemove.name}</strong>:
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleRemoveIntern(confirmRemove.id, true)}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition"
                  >
                    Remover da faculdade
                  </button>
                  <button
                    onClick={() => handleRemoveIntern(confirmRemove.id, false)}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition"
                  >
                    Apenas deste sorteio
                  </button>
                  <button
                    onClick={() => setConfirmRemove(null)}
                    className="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-300 transition"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-slate-200 px-6 py-4 bg-slate-50/50">
              <div className="flex items-center justify-between mb-3 text-xs text-slate-500">
                <span>Selecionados: <strong className="text-slate-700">{selectedCount}</strong></span>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-medium text-slate-600">Plantões por interno:</span>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => setMaxShifts(n)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${maxShifts === n
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {selectedCount > 0 && (
                <p className="mb-3 text-xs text-slate-500">
                  {selectedAtCapCount} de {selectedCount} selecionados já têm {maxShifts} ou mais plantões em USA nesta semana.
                </p>
              )}
              {lotteryMsg && <p className="text-sm mb-3">{lotteryMsg}</p>}
              <button
                onClick={runLottery}
                disabled={lotteryLoading || selectedCount === 0}
                className="w-full rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 py-3.5 text-base font-extrabold text-white shadow-[0_6px_20px_rgba(16,185,129,0.35)] hover:shadow-[0_8px_30px_rgba(16,185,129,0.5)] transition disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
              >
                <Dices className="h-5 w-5" /> SORTEAR
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ═══════════ Remove Confirmation Modal ═══════════ */}
      {removeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-red-500 to-rose-600 px-6 py-4 text-white">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <X className="h-5 w-5" /> Remover da Escala
              </h2>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-slate-700">
                Tem certeza que deseja remover <strong>{removeTarget.internName}</strong> do plantão?
              </p>
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
                <span className="font-medium">{removeTarget.baseCode}</span>
                {" · "}
                {formatDateLabel(removeTarget.date, { day: "2-digit", month: "2-digit", year: "numeric" })}
                {" · "}
                {removeTarget.period === "DAY" ? "☀️ Diurno" : "🌙 Noturno"}
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                ⚠️ Atenção: o plantão será cancelado e o interno precisará compensar com outro plantão para manter a meta.
              </div>
              {removeTarget.baseCode === "CRU" && (
                <div className="rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 text-xs text-violet-800">
                  ℹ️ Se este plantão veio do CRU fixo semanal, remover aqui afeta somente este dia. Para remover recorrência, use o painel "CRU — Fixos Semanais".
                </div>
              )}
              {removeError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                  ❌ {removeError}
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 px-6 py-4 bg-slate-50/50 flex gap-2">
              <button
                onClick={() => { setRemoveTarget(null); setRemoveError(""); }}
                disabled={removeLoading}
                className="flex-1 rounded-lg bg-slate-200 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 transition"
              >
                Cancelar
              </button>
              <button
                onClick={confirmRemoveAssignment}
                disabled={removeLoading}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-bold text-white hover:bg-red-700 transition disabled:opacity-50"
              >
                {removeLoading ? "Removendo..." : "Confirmar Remoção"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ Allocation Modal ═══════════ */}
      {allocSlot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-4 text-white flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Plus className="h-5 w-5" /> Alocar Interno
                </h2>
                <p className="text-sm text-blue-100">
                  {allocSlot.baseCode} · {formatDateLabel(allocSlot.date, { day: "2-digit", month: "2-digit", year: "numeric" })} · {allocSlot.period === "DAY" ? "☀️ Diurno" : "🌙 Noturno"}
                </p>
              </div>
              <button onClick={() => setAllocSlot(null)} className="rounded-lg p-1.5 hover:bg-white/20 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <label className="block text-sm font-medium text-slate-700">Buscar e selecionar interno:</label>
              {allocSlot.baseType === "CENTRAL" && allocSlot.period === "DAY" && isEbmsp && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Turno CRU:</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAllocShift("MORNING")}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${allocShift === "MORNING" ? "bg-amber-100 text-amber-800 ring-2 ring-amber-400" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    >
                      ☀️ Manhã (07h–13h)
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllocShift("AFTERNOON")}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${allocShift === "AFTERNOON" ? "bg-orange-100 text-orange-800 ring-2 ring-orange-400" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    >
                      🌤️ Tarde (13h–19h)
                    </button>
                  </div>
                </div>
              )}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={allocSearch}
                  onChange={(e) => setAllocSearch(e.target.value)}
                  placeholder="Buscar pelo nome"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
                {allocationCandidates.eligibleInterns.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">
                    Nenhum interno elegível neste turno.
                    {allocationCandidates.blockedCount > 0 ? ` ${allocationCandidates.blockedCount} bloqueado(s) por conflito CRU/CRL ±12h.` : ""}
                  </p>
                ) : (
                  allocationCandidates.eligibleInterns.map((intern) => (
                    <button
                      key={intern.id}
                      type="button"
                      onClick={() => setAllocInternId(intern.id)}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${allocInternId === intern.id ? "bg-blue-50 text-blue-700 ring-1 ring-blue-300" : "bg-white text-slate-700 hover:bg-slate-100"}`}
                    >
                      <span>{intern.name}</span>
                      {allocInternId === intern.id && <span className="text-xs font-semibold text-blue-600">Selecionado</span>}
                    </button>
                  ))
                )}
              </div>
              <p className="text-xs text-slate-500">
                {allocationCandidates.eligibleInterns.length === 0
                  ? "Nenhum interno livre para este dia e turno."
                  : `${allocationCandidates.eligibleInterns.length} interno(s) elegível(is) para este plantão.`}
              </p>
              {(allocationCandidates.blockedCount > 0 || allocationCandidates.busyCount > 0) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {allocationCandidates.blockedCount > 0 && <p>{allocationCandidates.blockedCount} interno(s) ocultado(s) por conflito CRU/CRL ±12h.</p>}
                  {allocationCandidates.busyCount > 0 && <p>{allocationCandidates.busyCount} interno(s) já ocupados neste mesmo dia e turno.</p>}
                </div>
              )}
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allocIsExtraShift}
                    onChange={(e) => setAllocIsExtraShift(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm font-medium text-slate-700">Plantão Extra</span>
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">Não conta para o rodízio</span>
                </label>
                {allocIsExtraShift && (
                  <input
                    value={allocExtraShiftNotes}
                    onChange={(e) => setAllocExtraShiftNotes(e.target.value)}
                    placeholder="Observações (opcional)"
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                )}
              </div>
              {allocMsg && <p className="text-sm">{allocMsg}</p>}
            </div>
            <div className="border-t border-slate-200 px-6 py-4 bg-slate-50/50 flex gap-2">
              <button
                onClick={() => setAllocSlot(null)}
                className="flex-1 rounded-lg bg-slate-200 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 transition"
              >
                Cancelar
              </button>
              <button
                onClick={submitAllocation}
                disabled={allocLoading || !allocInternId}
                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-bold text-white hover:bg-blue-700 transition disabled:opacity-50"
              >
                {allocLoading ? "Alocando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ CRU Fixed Add Modal ═══════════ */}
      {cruFixedAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-violet-500 to-purple-600 px-6 py-4 text-white flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Plus className="h-5 w-5" /> CRU Fixo Semanal
                </h2>
                <p className="text-sm text-violet-100">
                  {getDayLabel(cruFixedAdd.dayOfWeek)} · {cruFixedAdd.period === "DAY" ? "☀️ Diurno" : "🌙 Noturno"}
                </p>
              </div>
              <button onClick={() => setCruFixedAdd(null)} className="rounded-lg p-1.5 hover:bg-white/20 transition">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <label className="block text-sm font-medium text-slate-700">Selecionar interno:</label>
              <select
                value={cruFixedInternId}
                onChange={(e) => setCruFixedInternId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
              >
                <option value="">— Escolher —</option>
                {activeInterns
                  .filter((intern) => {
                    // Exclude interns already fixed for this day+period
                    return !cruFixed.some(
                      (c) =>
                        c.intern_id === intern.id &&
                        c.day_of_week === cruFixedAdd.dayOfWeek &&
                        c.period === cruFixedAdd.period,
                    );
                  })
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((intern) => (
                    <option key={intern.id} value={intern.id}>
                      {intern.name}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-slate-500">
                O interno será fixo na CRU toda {getDayLabel(cruFixedAdd.dayOfWeek)} ({cruFixedAdd.period === "DAY" ? "Diurno" : "Noturno"}).
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Duração (semanas):</label>
                <div className="flex items-center gap-1.5">
                  {[1, 2, 3, 4, 6, 8, 12].map((n) => (
                    <button
                      key={n}
                      onClick={() => setCruFixedWeeks(n)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${cruFixedWeeks === n
                        ? "bg-violet-600 text-white shadow-sm"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {!cruFixedWeeks && (
                  <p className="mt-1 text-xs text-amber-700">Selecione quantas semanas devem ser ocupadas a partir da semana atual.</p>
                )}
              </div>
              {cruFixedMsg && <p className="text-sm">{cruFixedMsg}</p>}
            </div>
            <div className="border-t border-slate-200 px-6 py-4 bg-slate-50/50 flex gap-2">
              <button
                onClick={() => setCruFixedAdd(null)}
                className="flex-1 rounded-lg bg-slate-200 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 transition"
              >
                Cancelar
              </button>
              <button
                onClick={addCruFixed}
                disabled={cruFixedLoading || !cruFixedInternId || !cruFixedWeeks}
                className="flex-1 rounded-lg bg-violet-600 py-2 text-sm font-bold text-white hover:bg-violet-700 transition disabled:opacity-50"
              >
                {cruFixedLoading ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ CRU Fixed Conflict Modal ═══════════ */}
      {cruConflictPending && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 text-white flex items-center gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <h2 className="text-lg font-bold">Conflito com Intervenção</h2>
                <p className="text-sm text-amber-100">
                  O interno já está escalado em USA nas datas abaixo
                </p>
              </div>
            </div>
            <div className="px-6 py-4 space-y-3">
              <p className="text-sm text-slate-600">
                Para alocar o CRU fixo nessas semanas, os plantões de intervenção conflitantes precisam ser removidos. Deseja continuar?
              </p>
              <div className="rounded-xl border border-amber-200 bg-amber-50 divide-y divide-amber-100 max-h-[220px] overflow-y-auto">
                {cruConflictPending.conflicts.map((c) => (
                  <div key={c.assignmentId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="font-medium text-slate-700">
                      {new Date(c.date + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}
                      {" "}· {c.period === "DAY" ? "☀️ Dia" : "🌙 Noite"}
                    </span>
                    <span className="rounded-full bg-amber-200 text-amber-800 px-2 py-0.5 text-xs font-bold">{c.baseCode}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400">
                Os plantões de USA listados serão <strong>cancelados</strong> e substituídos por CRU fixo.
              </p>
            </div>
            <div className="border-t border-slate-200 px-6 py-4 bg-slate-50/50 flex gap-2">
              <button
                onClick={() => setCruConflictPending(null)}
                className="flex-1 rounded-lg bg-slate-200 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 transition"
              >
                Manter USA
              </button>
              <button
                onClick={forceCruFixed}
                disabled={cruFixedLoading}
                className="flex-1 rounded-lg bg-orange-500 py-2 text-sm font-bold text-white hover:bg-orange-600 transition disabled:opacity-50"
              >
                {cruFixedLoading ? "Processando..." : "Remover USA e alocar CRU"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ Intern Detail Modal ═══════════ */}
      {internDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setInternDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">👤 {internDetail.name}</h3>
              <button onClick={() => setInternDetail(null)} className="rounded-full p-1 hover:bg-slate-100 transition"><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded-lg font-medium">☀️ {internWeekAssignments.filter(a => a.period === "DAY").length} diurnos</span>
                <span className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded-lg font-medium">🌙 {internWeekAssignments.filter(a => a.period === "NIGHT").length} noturnos</span>
                <span className="text-slate-500 ml-auto">{internWeekAssignments.length} total</span>
              </div>
              {internWeekAssignments.length > 0 ? (
                <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                  {internWeekAssignments
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((a) => {
                      const ps = getPeriodStyle(a.period);
                      const bs = getBaseStyle(a.baseType as "USA" | "CENTRAL" | "CRL");
                      return (
                        <div key={a.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${ps.bg}`}>
                          <span className="text-sm">{ps.emoji}</span>
                          <span className={`text-xs font-bold ${ps.text}`}>{a.date.slice(5)}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${bs.pill}`}>{a.baseCode}</span>
                          <span className={`ml-auto text-[10px] font-medium ${a.status === "CHECKED_IN" ? "text-emerald-600" : a.status === "ABSENT" ? "text-red-600" : "text-slate-400"}`}>{a.status}</span>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-4">Nenhum plantão nesta semana</p>
              )}
              <a
                href={`/taximetro/leader/internos`}
                className="block w-full text-center rounded-lg bg-slate-900 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition mt-2"
              >
                Ver perfil completo →
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}