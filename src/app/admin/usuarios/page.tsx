"use client";

import { useEffect, useState } from "react";
import { getFacultyStyle } from "@/lib/base-colors";
import { ChevronDown, ChevronUp, ChevronRight, RotateCcw, SlidersHorizontal, List, LayoutGrid } from "lucide-react";
import { InviteButton } from "@/components/invite-button";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { formatBrazilTime } from "@/lib/utils";
import { filterUsers, countActiveFilters, EMPTY_FILTERS, type UserFilters } from "./filter-users";
import { ROLES, ROLE_LABEL, ROLE_BADGE_CLASS, type User, type Faculty, type Base, type Cohort } from "./user-meta";
import { UserDrawer } from "@/components/admin/user-drawer";

const MERGE_ROLLBACK_WINDOW_DAYS = 7;

// Basal da página: só ativos. "Todos" é escolha explícita (vira ?status=all na URL).
const DEFAULT_FILTERS: UserFilters = { ...EMPTY_FILTERS, status: "active" };

type DuplicateGroup = {
  key: string;
  users: User[];
  suggestedTargetId: string;
};

type RecentMergeEvent = {
  id: string;
  sourceUserId: string;
  sourceName: string;
  sourceEmail: string;
  targetUserId: string;
  targetName: string;
  targetEmail: string;
  createdAt: string;
  rollbackAvailableUntil: string;
};

function normalizeDuplicateKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compareDuplicateUsers(left: User, right: User) {
  if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
  if (Boolean(left.registrationCode) !== Boolean(right.registrationCode)) return left.registrationCode ? -1 : 1;
  if (Boolean(left.cpf) !== Boolean(right.cpf)) return left.cpf ? -1 : 1;
  if ((left.createdAt ?? "") !== (right.createdAt ?? "")) return (left.createdAt ?? "").localeCompare(right.createdAt ?? "");
  return left.email.localeCompare(right.email);
}

export default function AdminUsuarios() {
  const [users, setUsers] = useState<User[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [bases, setBases] = useState<Base[]>([]);
  const [allCohorts, setAllCohorts] = useState<Cohort[]>([]);
  const [cohortSaving, setCohortSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<UserFilters>(() => {
    if (typeof window === "undefined") return DEFAULT_FILTERS;
    const p = new URLSearchParams(window.location.search);
    const rawStatus = p.get("status");
    return {
      q: p.get("q") ?? "",
      status: rawStatus === "all" ? "" : ((rawStatus as UserFilters["status"]) ?? "active"),
      fac: p.get("fac") ?? "",
      turma: p.get("turma") ?? "",
      papel: p.get("papel") ?? "",
      sort: (p.get("sort") as UserFilters["sort"]) ?? "",
    };
  });
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<"list" | "grid">(() => {
    if (typeof window === "undefined") return "list";
    return new URLSearchParams(window.location.search).get("view") === "grid" ? "grid" : "list";
  });
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const [drawerUserId, setDrawerUserId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("u");
  });
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeSaving, setMergeSaving] = useState(false);
  const [mergeMessage, setMergeMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [recentMergeEvents, setRecentMergeEvents] = useState<RecentMergeEvent[]>([]);
  const [rollbackingMergeId, setRollbackingMergeId] = useState<string | null>(null);

  async function load() {
    try {
      const [uRes, fRes, bRes, mergeRes, cRes] = await Promise.all([
        fetch("/taximetro/api/admin/users").then((r) => r.json()),
        fetch("/taximetro/api/admin/faculties").then((r) => r.json()),
        fetch("/taximetro/api/admin/bases").then((r) => r.json()),
        fetch("/taximetro/api/admin/users/merge-events").then((r) => r.json()).catch(() => ({ success: false, data: [] })),
        fetch("/taximetro/api/admin/cohorts?status=PLANNED&status=ACTIVE").then((r) => r.json()).catch(() => ({ success: false, data: [] })),
      ]);
      if (uRes.success) setUsers(uRes.data);
      if (fRes.success) setFaculties(fRes.data);
      if (bRes.success) setBases(bRes.data);
      if (mergeRes.success) setRecentMergeEvents(mergeRes.data);
      if (cRes.success) setAllCohorts(cRes.data);
    } catch {
      setError("Erro ao carregar usuários.");
    }
    setLoading(false);
  }

  async function assignCohort(userRoleId: string, cohortId: string | null) {
    setCohortSaving((s) => ({ ...s, [userRoleId]: true }));
    try {
      const res = await fetch("/taximetro/api/admin/interns/cohort", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userRoleId, cohortId }),
      });
      const json = await res.json();
      if (!json.success) alert(json.error || "Erro ao atribuir turma.");
      else load();
    } catch {
      alert("Erro de conexão.");
    } finally {
      setCohortSaving((s) => ({ ...s, [userRoleId]: false }));
    }
  }

  useEffect(() => { load(); }, []);

  // Espelha filtros na URL (replaceState = sem reload, sobrevive a refresh/voltar).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(filters)) {
      if (k === "status") {
        // "active" é o basal (URL limpa); "" (todos) vira ?status=all
        if (v === "active") p.delete(k);
        else p.set(k, v || "all");
        continue;
      }
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (view === "grid") p.set("view", "grid");
    else p.delete("view");
    const qs = p.toString();
    window.history.replaceState(window.history.state, "", qs ? `?${qs}` : window.location.pathname);
  }, [filters, view]);

  // Botão voltar do navegador fecha (ou reabre) o drawer.
  useEffect(() => {
    function onPop() {
      setDrawerUserId(new URLSearchParams(window.location.search).get("u"));
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function openDrawer(id: string) {
    setDrawerUserId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("u", id);
    window.history.pushState({ drawer: true }, "", url);
  }

  function navigateDrawer(id: string) {
    setDrawerUserId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("u", id);
    window.history.replaceState(window.history.state, "", url);
  }

  function closeDrawer() {
    setDrawerUserId(null);
    if (window.history.state?.drawer) {
      window.history.back();
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("u");
      window.history.replaceState(null, "", url);
    }
  }

  async function approve(userId: string) {
    try {
      const res = await fetch("/taximetro/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, isActive: true }),
      });
      const json = await res.json();
      if (!json.success) { alert(json.error); return; }
      load();
    } catch {
      alert("Erro de conexão.");
    }
  }

  const pendingCount = users.filter((u) => !u.isActive).length;

  const filtered = filterUsers(users, filters);
  // "ativos" é o basal — só conta como filtro o que desvia do padrão
  const activeFilterCount = countActiveFilters({ ...filters, status: filters.status === "active" ? "" : filters.status });
  const facultyAbbrById = new Map(faculties.map((f) => [f.id, f.abbreviation]));
  const turmaOptions = filters.fac ? allCohorts.filter((c) => c.facultyId === filters.fac) : allCohorts;

  const drawerIndex = drawerUserId && drawerUserId !== "new" ? filtered.findIndex((u) => u.id === drawerUserId) : -1;
  const drawerPrevId = drawerIndex > 0 ? filtered[drawerIndex - 1].id : null;
  const drawerNextId = drawerIndex >= 0 && drawerIndex < filtered.length - 1 ? filtered[drawerIndex + 1].id : null;
  const drawerPosition = drawerIndex >= 0 ? `${drawerIndex + 1} de ${filtered.length}` : undefined;

  const duplicateGroups = users.reduce<DuplicateGroup[]>((groups, user) => {
    const key = normalizeDuplicateKey(user.name);
    if (!key) return groups;

    const existing = groups.find((group) => group.key === key);
    if (existing) {
      existing.users.push(user);
      return groups;
    }

    groups.push({ key, users: [user], suggestedTargetId: user.id });
    return groups;
  }, []).filter((group) => group.users.length > 1)
    .map((group) => ({
      ...group,
      users: [...group.users].sort(compareDuplicateUsers),
      suggestedTargetId: [...group.users].sort(compareDuplicateUsers)[0]?.id ?? "",
    }));

  async function mergeUsers() {
    if (!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId) {
      setMergeMessage({ type: "error", text: "Escolha um cadastro para remover e outro para manter." });
      return;
    }

    const sourceUser = users.find((user) => user.id === mergeSourceId);
    const targetUser = users.find((user) => user.id === mergeTargetId);
    if (!sourceUser || !targetUser) {
      setMergeMessage({ type: "error", text: "Cadastros selecionados não foram encontrados." });
      return;
    }

    const confirmed = window.confirm(`Mesclar ${sourceUser.name} (${sourceUser.email}) em ${targetUser.name} (${targetUser.email})? O cadastro fonte ficará oculto e poderá ser desfeito por até ${MERGE_ROLLBACK_WINDOW_DAYS} dias.`);
    if (!confirmed) return;

    setMergeSaving(true);
    setMergeMessage(null);
    try {
      const res = await fetch("/taximetro/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUserId: mergeSourceId, targetUserId: mergeTargetId }),
      });
      const json = await res.json();
      if (!json.success) {
        setMergeMessage({ type: "error", text: json.error || "Não foi possível mesclar os cadastros." });
        return;
      }

      setMergeMessage({ type: "success", text: `Cadastros mesclados com sucesso. Se precisar, o rollback automático fica disponível por ${MERGE_ROLLBACK_WINDOW_DAYS} dias.` });
      setMergeSourceId("");
      setMergeTargetId("");
      await load();
    } catch {
      setMergeMessage({ type: "error", text: "Erro de conexão ao mesclar os cadastros." });
    } finally {
      setMergeSaving(false);
    }
  }

  async function mergeDuplicateGroup(group: DuplicateGroup) {
    const targetUser = group.users.find((user) => user.id === group.suggestedTargetId) ?? group.users[0];
    const sourceUsers = group.users.filter((user) => user.id !== targetUser?.id);
    if (!targetUser || sourceUsers.length === 0) return;

    const confirmed = window.confirm(`Mesclar ${sourceUsers.length} cadastro(s) de ${targetUser.name} mantendo ${targetUser.email} como principal? O rollback automático ficará disponível por ${MERGE_ROLLBACK_WINDOW_DAYS} dias para cada merge realizado.`);
    if (!confirmed) return;

    setMergeSaving(true);
    setMergeMessage(null);
    try {
      for (const sourceUser of sourceUsers) {
        const res = await fetch("/taximetro/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceUserId: sourceUser.id, targetUserId: targetUser.id }),
        });
        const json = await res.json();
        if (!json.success) {
          setMergeMessage({ type: "error", text: json.error || `Não foi possível mesclar ${sourceUser.email}.` });
          return;
        }
      }

      setMergeSourceId("");
      setMergeTargetId("");
      setMergeMessage({ type: "success", text: `Cadastros de ${targetUser.name} mesclados em ${targetUser.email}. O rollback automático fica disponível por ${MERGE_ROLLBACK_WINDOW_DAYS} dias.` });
      await load();
    } catch {
      setMergeMessage({ type: "error", text: "Erro de conexão ao mesclar o grupo duplicado." });
    } finally {
      setMergeSaving(false);
    }
  }

  async function rollbackMerge(event: RecentMergeEvent) {
    const confirmed = window.confirm(`Desfazer a mesclagem de ${event.sourceName} (${event.sourceEmail}) em ${event.targetName} (${event.targetEmail})?`);
    if (!confirmed) return;

    setRollbackingMergeId(event.id);
    setMergeMessage(null);
    try {
      const res = await fetch("/taximetro/api/admin/users/merge-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mergeEventId: event.id }),
      });
      const json = await res.json();
      if (!json.success) {
        setMergeMessage({ type: "error", text: json.error || "Não foi possível desfazer a mesclagem." });
        return;
      }

      setMergeMessage({ type: "success", text: `Mesclagem desfeita. O cadastro ${event.sourceEmail} voltou ao estado anterior.` });
      await load();
    } catch {
      setMergeMessage({ type: "error", text: "Erro de conexão ao desfazer a mesclagem." });
    } finally {
      setRollbackingMergeId(null);
    }
  }

  if (loading) return <p className="text-slate-400">Carregando...</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Usuários</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <InviteButton />
          {pendingCount > 0 && (
            <button
              onClick={() => setFilters((f) => ({ ...f, status: f.status === "pending" ? "active" : "pending" }))}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${filters.status === "pending"
                ? "bg-amber-500 text-white hover:bg-amber-600"
                : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                }`}
            >
              Pendentes ({pendingCount})
            </button>
          )}
          <input value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="Buscar..." className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" />
          <button onClick={() => openDrawer("new")} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 whitespace-nowrap">
            + Novo
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:hidden"
        >
          <SlidersHorizontal className="h-4 w-4" />
          Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <div className={`${showFilters ? "flex" : "hidden"} flex-wrap items-center gap-1.5 sm:flex`}>
          <span className="text-xs text-slate-400">Faculdade:</span>
          <button
            onClick={() => setFilters((f) => ({ ...f, fac: "", turma: "" }))}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${!filters.fac ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            Todas
          </button>
          {faculties.map((f) => {
            const fst = getFacultyStyle(f.abbreviation);
            const active = filters.fac === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilters((fl) => ({ ...fl, fac: active ? "" : f.id, turma: "" }))}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-shadow ${fst.pill} ${active ? "ring-2 ring-slate-900" : "hover:ring-1 hover:ring-slate-300"}`}
                aria-pressed={active}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                {f.abbreviation}
              </button>
            );
          })}
        </div>
        <div className={`${showFilters ? "grid" : "hidden"} grid-cols-2 gap-2 sm:grid sm:grid-cols-4`}>
          <Sel
            label="Status"
            value={filters.status}
            options={["", "active", "pending", "archived"]}
            labels={["Todos", "Ativos", "Pendentes", "Arquivados"]}
            onChange={(v) => setFilters((f) => ({ ...f, status: v as UserFilters["status"] }))}
          />
          <Sel
            label="Turma"
            value={filters.turma}
            options={["", ...turmaOptions.map((c) => c.id)]}
            labels={["Todas", ...turmaOptions.map((c) => filters.fac ? (c.name ?? c.label) : `${facultyAbbrById.get(c.facultyId) ?? "?"} · ${c.name ?? c.label}`)]}
            onChange={(v) => setFilters((f) => ({ ...f, turma: v }))}
          />
          <Sel
            label="Papel"
            value={filters.papel}
            options={["", ...ROLES]}
            labels={["Todos", ...ROLES.map((r) => ROLE_LABEL[r])]}
            onChange={(v) => setFilters((f) => ({ ...f, papel: v }))}
          />
          <Sel
            label="Ordenar por"
            value={filters.sort}
            options={["", "newest", "oldest"]}
            labels={["Nome A–Z", "Cadastro mais recente", "Cadastro mais antigo"]}
            onChange={(v) => setFilters((f) => ({ ...f, sort: v as UserFilters["sort"] }))}
          />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
          <span>{filtered.length === users.length ? `${users.length} usuários` : `${filtered.length} de ${users.length} usuários`}</span>
          <div className="flex items-center gap-3">
            {(activeFilterCount > 0 || filters.q || filters.sort || filters.status !== "active") && (
              <button onClick={() => setFilters(DEFAULT_FILTERS)} className="font-medium text-accent-600 hover:text-accent-500">
                Limpar filtros
              </button>
            )}
            <div className="flex rounded-lg border border-slate-200 p-0.5" role="group" aria-label="Modo de exibição">
              <button
                onClick={() => setView("list")}
                aria-pressed={view === "list"}
                title="Lista"
                className={`rounded-md p-1.5 ${view === "list" ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:text-slate-600"}`}
              >
                <List className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView("grid")}
                aria-pressed={view === "grid"}
                title="Galeria de fotos"
                className={`rounded-md p-1.5 ${view === "grid" ? "bg-slate-100 text-slate-800" : "text-slate-400 hover:text-slate-600"}`}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {recentMergeEvents.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 shadow-sm space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-sky-900">Mesclagens recentes com rollback disponível</h2>
            <p className="text-xs text-sky-800">Se o admin mesclar a conta errada, dá para desfazer por aqui enquanto a janela automática ainda estiver aberta.</p>
          </div>
          <div className="space-y-2">
            {recentMergeEvents.map((event) => (
              <div key={event.id} className="flex flex-col gap-3 rounded-lg border border-sky-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{event.sourceName} → {event.targetName}</p>
                  <p className="text-xs text-slate-500">{event.sourceEmail} mesclado em {event.targetEmail}</p>
                  <p className="text-xs text-slate-400">Mesclado em {formatBrazilTime(event.createdAt)} · rollback até {formatBrazilTime(event.rollbackAvailableUntil)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => rollbackMerge(event)}
                  disabled={rollbackingMergeId === event.id || mergeSaving}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {rollbackingMergeId === event.id ? "Desfazendo..." : "Desfazer merge"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {duplicateGroups.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-amber-900">Possíveis cadastros duplicados</h2>
            <p className="text-xs text-amber-800">A lista abaixo agrupa nomes idênticos. Mesclar move plantões e vínculos para o cadastro que vai sobreviver, mas a operação bloqueia se houver conflito de plantão no mesmo dia e turno.</p>
          </div>

          <div className="space-y-3">
            {duplicateGroups.map((group) => (
              <div key={group.key} className="rounded-lg border border-amber-200 bg-white p-3 space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{group.users[0]?.name}</p>
                    <p className="text-xs text-slate-500">Principal sugerido: {group.users.find((user) => user.id === group.suggestedTargetId)?.email ?? "—"}</p>
                  </div>
                  <button onClick={() => mergeDuplicateGroup(group)} disabled={mergeSaving || group.users.length < 2} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60">
                    {mergeSaving ? "Mesclando..." : "Mesclar grupo automaticamente"}
                  </button>
                </div>
                <div className="space-y-2">
                  {group.users.map((user) => (
                    <label key={user.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium text-slate-900">{user.email}</p>
                        <p className="text-xs text-slate-500">CPF: {user.cpf ?? "—"} · Papel: {ROLE_LABEL[user.role ?? ""] ?? user.role ?? "—"} · {user.isActive ? "Ativo" : "Pendente"}{group.suggestedTargetId === user.id ? " · sugerido manter" : ""}</p>
                      </div>
                      <div className="flex gap-2 text-xs">
                        <button type="button" onClick={() => setMergeTargetId(user.id)} className={`rounded px-2 py-1 ${mergeTargetId === user.id ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700"}`}>
                          Manter
                        </button>
                        <button type="button" onClick={() => setMergeSourceId(user.id)} className={`rounded px-2 py-1 ${mergeSourceId === user.id ? "bg-red-600 text-white" : "bg-red-50 text-red-700"}`}>
                          Remover
                        </button>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs text-slate-500">
              <p>Cadastro a remover: {users.find((user) => user.id === mergeSourceId)?.email ?? "—"}</p>
              <p>Cadastro a manter: {users.find((user) => user.id === mergeTargetId)?.email ?? "—"}</p>
            </div>
            <button onClick={mergeUsers} disabled={mergeSaving || !mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60">
              {mergeSaving ? "Mesclando..." : "Mesclar cadastros"}
            </button>
          </div>

          {mergeMessage && (
            <div className={`rounded-lg px-3 py-2 text-sm ${mergeMessage.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {mergeMessage.text}
            </div>
          )}
        </div>
      )}

      {view === "grid" && (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filtered.map((u) => (
              <button
                key={u.id}
                onClick={() => openDrawer(u.id)}
                className={`group overflow-hidden rounded-xl border text-left shadow-sm transition-shadow hover:shadow-md ${!u.isActive ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-white"}`}
              >
                <Avatar
                  userId={u.id}
                  name={u.name}
                  className="aspect-square w-full rounded-none text-4xl"
                />
                <div className="space-y-0.5 p-2">
                  <p className="truncate text-sm font-medium text-slate-900">{u.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {[u.facultyAbbr, u.allRoles?.find((r) => r.role === "INTERN")?.cohortName].filter(Boolean).join(" · ") || ROLE_LABEL[u.role ?? ""] || "—"}
                  </p>
                  {!u.isActive && <p className="text-[10px] font-medium text-amber-700">Pendente</p>}
                  {u.isActive && u.isArchived && <p className="text-[10px] font-medium text-slate-500">Arquivado</p>}
                </div>
              </button>
            ))}
          </div>
          {filtered.length === 0 && <p className="py-8 text-center text-slate-500">Nenhum usuário encontrado.</p>}
        </div>
      )}

      {view === "list" && (
        <div className="space-y-2 md:hidden">
          {filtered.map((u) => (
            <button
              key={u.id}
              onClick={() => openDrawer(u.id)}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left shadow-sm ${!u.isActive ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-white"}`}
            >
              <Avatar userId={u.id} name={u.name} className="h-12 w-12 shrink-0 rounded-full text-base" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{u.name}</p>
                <p className="truncate text-xs text-slate-500">
                  {[u.facultyAbbr, u.allRoles?.find((r) => r.role === "INTERN")?.cohortName].filter(Boolean).join(" · ") || ROLE_LABEL[u.role ?? ""] || "—"}
                </p>
              </div>
              {!u.isActive && (
                <span className="shrink-0 rounded px-2 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700">Pendente</span>
              )}
              {u.isActive && u.isArchived && (
                <span className="shrink-0 rounded px-2 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600">Arquivado</span>
              )}
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
            </button>
          ))}
          {filtered.length === 0 && <p className="py-8 text-center text-slate-500">Nenhum usuário encontrado.</p>}
        </div>
      )}

      {view === "list" && (
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="pb-2 pr-4"></th>
              <th className="pb-2 pr-4">Nome</th>
              <th className="pb-2 pr-4">CPF</th>
              <th className="pb-2 pr-4">Papel</th>
              <th className="pb-2 pr-4">Faculdade</th>
              <th className="pb-2 pr-4">Turma</th>
              <th className="pb-2 pr-4">Ativo</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr
                key={u.id}
                onClick={() => openDrawer(u.id)}
                className={`cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 ${!u.isActive ? "bg-amber-50/50" : ""}`}
              >
                <td className="py-2 pr-2">
                  <Avatar
                    userId={u.id}
                    name={u.name}
                    className="h-8 w-8 rounded-full text-xs"
                    onZoom={(src) => setZoom({ src, alt: `Foto de ${u.name}` })}
                  />
                </td>
                <td className="py-2 pr-4">{u.name}</td>
                <td className="py-2 pr-4 font-mono text-xs">{u.cpf}</td>
                <td className="py-2 pr-4">
                  <div className="flex flex-wrap gap-1.5">
                    {(u.allRoles && u.allRoles.length > 0) ? (
                      u.allRoles.map((r, idx) => {
                        const scope = r.role === "LEADER" || r.role === "INTERN"
                          ? r.facultyAbbr
                          : r.role === "PRECEPTOR"
                            ? r.baseCode
                            : null;
                        const cohortTag = r.role === "INTERN" && r.cohortName ? ` (${r.cohortName})` : "";
                        const label = `${ROLE_LABEL[r.role]}${scope ? ` · ${scope}` : ""}${cohortTag}`;
                        return (
                          <span
                            key={`${u.id}-${r.role}-${r.facultyId ?? ""}-${r.baseId ?? ""}-${idx}`}
                            className={`rounded px-2 py-0.5 text-xs font-medium ${ROLE_BADGE_CLASS[r.role] ?? "bg-slate-50 text-slate-700"}`}
                            title={label}
                          >
                            {label}
                          </span>
                        );
                      })
                    ) : (
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${ROLE_BADGE_CLASS[u.role ?? ""] ?? "bg-slate-50 text-slate-700"}`}>
                        {ROLE_LABEL[u.role ?? ""] ?? u.role ?? "—"}
                      </span>
                    )}
                    {u.alsoPreceptor && (!u.allRoles || !u.allRoles.some((r) => r.role === "PRECEPTOR")) && (
                      <span className="rounded px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700">Também preceptor</span>
                    )}
                  </div>
                </td>
                <td className="py-2 pr-4">
                  {u.facultyAbbr ? (() => {
                    const fst = getFacultyStyle(u.facultyAbbr);
                    return (
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fst.pill}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                        {u.facultyAbbr}
                      </span>
                    );
                  })() : "—"}
                </td>
                <td className="py-2 pr-4" onClick={(e) => e.stopPropagation()}>
                  {(() => {
                    const internRole = u.allRoles?.find((r) => r.role === "INTERN");
                    if (!internRole?.id) return <span className="text-xs text-slate-400">—</span>;
                    const facultyCohorts = allCohorts.filter((c) => c.facultyId === internRole.facultyId);
                    const saving = cohortSaving[internRole.id] ?? false;
                    return (
                      <select
                        disabled={saving}
                        value={internRole.cohortId ?? ""}
                        onChange={(e) => assignCohort(internRole.id!, e.target.value || null)}
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 disabled:opacity-60"
                      >
                        <option value="">— sem turma —</option>
                        {facultyCohorts.map((c) => (
                          <option key={c.id} value={c.id}>{c.name ?? c.label}</option>
                        ))}
                      </select>
                    );
                  })()}
                </td>
                <td className="py-2 pr-4">
                  {u.isActive ? (
                    u.isArchived ? (
                      <span className="inline-block rounded px-2 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600">Arquivado</span>
                    ) : (
                      <span className="inline-block rounded px-2 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700">Ativo</span>
                    )
                  ) : (
                    <span className="inline-block rounded px-2 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700">Pendente</span>
                  )}
                </td>
                <td className="py-2">
                  <div className="flex items-center justify-end gap-2">
                    {!u.isActive && (
                      <button
                        onClick={(e) => { e.stopPropagation(); approve(u.id); }}
                        className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        Aprovar
                      </button>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="py-8 text-center text-slate-500">Nenhum usuário encontrado.</p>}
      </div>
      )}

      {zoom && <PhotoLightbox src={zoom.src} alt={zoom.alt} onClose={() => setZoom(null)} />}

      {drawerUserId && (
        <UserDrawer
          userId={drawerUserId}
          initialUser={users.find((u) => u.id === drawerUserId)}
          faculties={faculties}
          bases={bases}
          prevId={drawerPrevId}
          nextId={drawerNextId}
          position={drawerPosition}
          onNavigate={navigateDrawer}
          onClose={closeDrawer}
          onChanged={load}
        />
      )}
    </div>
  );
}

function Avatar({ userId, name, className, onZoom }: { userId: string; name: string; className: string; onZoom?: (src: string) => void }) {
  const [failed, setFailed] = useState(false);
  const src = `/taximetro/api/admin/users/${userId}/selfie`;
  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 font-medium text-slate-400 ${className}`}>
        {name.charAt(0)}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={`Foto de ${name}`}
      loading="lazy"
      onError={() => setFailed(true)}
      onClick={onZoom ? (e) => { e.stopPropagation(); onZoom(src); } : undefined}
      className={`object-cover ${onZoom ? "cursor-zoom-in" : ""} ${className}`}
    />
  );
}

function Sel({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: string[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
        {options.map((o, i) => <option key={o} value={o}>{labels ? labels[i] : o}</option>)}
      </select>
    </label>
  );
}
