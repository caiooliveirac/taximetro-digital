"use client";

import { Fragment, useEffect, useState, useRef } from "react";
import { getFacultyStyle } from "@/lib/base-colors";
import { FileDown, KeyRound, Mail, ChevronDown, ChevronUp, RotateCcw, Archive, ArchiveRestore } from "lucide-react";
import { InviteButton } from "@/components/invite-button";
import { formatBrazilTime } from "@/lib/utils";

const MERGE_ROLLBACK_WINDOW_DAYS = 7;

type User = {
  id: string;
  name: string;
  cpf: string;
  email: string;
  phone: string | null;
  registrationCode: string | null;
  isActive: boolean;
  isArchived?: boolean;
  selfie: string | null;
  role: string | null;
  facultyId: string | null;
  facultyAbbr: string | null;
  baseId: string | null;
  baseCode: string | null;
  alsoPreceptor?: boolean;
  createdAt?: string;
  allRoles?: Array<{
    role: "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN";
    facultyId: string | null;
    facultyAbbr: string | null;
    baseId: string | null;
    baseCode: string | null;
  }>;
};

type Faculty = { id: string; abbreviation: string };
type Base = { id: string; code: string; name: string };

type HistoryAssignment = {
  id: string;
  date: string;
  period: string;
  assignment_status: string;
  base_code: string;
  base_name: string;
  checkin_status: string | null;
  geo_valid: boolean | null;
  checkin_method: string | null;
  checkin_at: string | null;
  checkout_at: string | null;
};

type HistoryRequest = {
  id: string;
  type: string;
  status: string;
  created_at: string;
  review_notes: string | null;
  assignment_date: string | null;
  base_code: string | null;
  extra_base_code: string | null;
  extra_date: string | null;
  extra_period: string | null;
};

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

const ROLES = ["COORDINATOR", "LEADER", "PRECEPTOR", "INTERN"] as const;
const ROLE_LABEL: Record<string, string> = {
  COORDINATOR: "Coordenador",
  LEADER: "Líder de Escala",
  PRECEPTOR: "Preceptor",
  INTERN: "Interno",
};

const ROLE_BADGE_CLASS: Record<string, string> = {
  COORDINATOR: "bg-purple-50 text-purple-700",
  LEADER: "bg-emerald-50 text-emerald-700",
  PRECEPTOR: "bg-amber-50 text-amber-700",
  INTERN: "bg-blue-50 text-blue-700",
};

const OUTCOME_LABEL: Record<string, string> = {
  SCHEDULED: "Agendado",
  CONFIRMED: "Confirmado",
  CHECKED_IN: "Presente",
  CHECKED_OUT: "Finalizado",
  ABSENT: "Ausente",
  CANCELLED: "Cancelado",
};

const OUTCOME_COLOR: Record<string, string> = {
  SCHEDULED: "",
  CONFIRMED: "bg-blue-50",
  CHECKED_IN: "bg-emerald-50",
  CHECKED_OUT: "bg-emerald-50",
  ABSENT: "bg-red-50",
  CANCELLED: "bg-slate-50",
};

function getRowOutcome(a: HistoryAssignment): { label: string; bg: string } {
  if (a.assignment_status === "ABSENT") return { label: "Ausente", bg: "bg-red-50" };
  if (a.geo_valid === false) return { label: "Erro geolocalização", bg: "bg-purple-50" };
  if (a.checkin_status === "EXPIRED") return { label: "TOTP expirado", bg: "bg-violet-50" };
  if (a.checkin_status === "REJECTED") return { label: "Erro QR", bg: "bg-fuchsia-50" };
  return {
    label: OUTCOME_LABEL[a.assignment_status] ?? a.assignment_status,
    bg: OUTCOME_COLOR[a.assignment_status] ?? "",
  };
}

const REQ_TYPE_LABEL: Record<string, string> = { SWAP: "Troca", EXTRA_SHIFT: "Extra", DROP_SHIFT: "Descarte" };
const REQ_STATUS_LABEL: Record<string, string> = { PENDING: "Pendente", APPROVED: "Aprovada", REJECTED: "Rejeitada" };
const REQ_STATUS_COLOR: Record<string, string> = { PENDING: "bg-amber-50 text-amber-700", APPROVED: "bg-emerald-50 text-emerald-700", REJECTED: "bg-red-50 text-red-700" };

export default function AdminUsuarios() {
  const [users, setUsers] = useState<User[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [bases, setBases] = useState<Base[]>([]);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showPending, setShowPending] = useState(false);
  const [history, setHistory] = useState<{ assignments: HistoryAssignment[]; requests: HistoryRequest[] } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [accessRowUserId, setAccessRowUserId] = useState<string | null>(null);
  const [accessEmail, setAccessEmail] = useState("");
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessMessage, setAccessMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeSaving, setMergeSaving] = useState(false);
  const [mergeMessage, setMergeMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [recentMergeEvents, setRecentMergeEvents] = useState<RecentMergeEvent[]>([]);
  const [rollbackingMergeId, setRollbackingMergeId] = useState<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  /**
   * Deriva o conjunto de roles marcadas no form a partir de `editing`.
   * Precedencia:
   *   1. editing.selectedRoles (estado local apos usuario marcar checkboxes)
   *   2. editing.allRoles (vindo da API — multi-role fonte de verdade)
   *   3. editing.role + editing.alsoPreceptor (legacy / form novo)
   */
  function getSelectedRoles(): Set<"COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN"> {
    if (!editing) return new Set();
    const fromState = editing.selectedRoles;
    if (Array.isArray(fromState)) {
      return new Set(fromState as Array<"COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN">);
    }
    const allRoles = editing.allRoles as User["allRoles"];
    if (Array.isArray(allRoles) && allRoles.length > 0) {
      return new Set(allRoles.map((r) => r.role));
    }
    const legacyRole = editing.role as "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN" | undefined;
    const set = new Set<"COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN">();
    if (legacyRole) set.add(legacyRole);
    if (editing.alsoPreceptor) set.add("PRECEPTOR");
    if (legacyRole === "COORDINATOR") set.add("PRECEPTOR"); // regra historica
    return set;
  }

  function toggleRole(role: "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN", checked: boolean) {
    if (!editing) return;
    const current = getSelectedRoles();
    if (checked) current.add(role);
    else current.delete(role);

    const next = Array.from(current);
    // Se PRECEPTOR saiu, limpa baseId. Se LEADER e INTERN sairam, limpa facultyId.
    const needsFaculty = current.has("LEADER") || current.has("INTERN");
    const needsBase = current.has("PRECEPTOR");

    setEditing({
      ...editing,
      selectedRoles: next,
      facultyId: needsFaculty ? (editing.facultyId ?? null) : null,
      baseId: needsBase ? (editing.baseId ?? null) : null,
    });
  }

  async function load() {
    try {
      const [uRes, fRes, bRes, mergeRes] = await Promise.all([
        fetch("/taximetro/api/admin/users").then((r) => r.json()),
        fetch("/taximetro/api/admin/faculties").then((r) => r.json()),
        fetch("/taximetro/api/admin/bases").then((r) => r.json()),
        fetch("/taximetro/api/admin/users/merge-events").then((r) => r.json()).catch(() => ({ success: false, data: [] })),
      ]);
      if (uRes.success) setUsers(uRes.data);
      if (fRes.success) setFaculties(fRes.data);
      if (bRes.success) setBases(bRes.data);
      if (mergeRes.success) setRecentMergeEvents(mergeRes.data);
    } catch {
      setError("Erro ao carregar usuários.");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function loadHistory(userId: string) {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/taximetro/api/admin/users/${userId}/history`);
      const json = await res.json();
      if (json.success) setHistory(json.data);
    } catch {
      setHistory(null);
    }
    setHistoryLoading(false);
  }

  async function openEdit(user: User) {
    setEditing({ ...user, password: undefined, selfie: null });
    setHistory(null);
    try {
      const res = await fetch(`/taximetro/api/admin/users?id=${user.id}&includeSelfie=1`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data) && json.data[0]) {
        const row = json.data[0] as User;
        // Normaliza facultyId/baseId do form a partir de allRoles (se existir),
        // para que usuarios multi-role (ex.: LEADER@F1 + PRECEPTOR@B1) abram
        // com ambos os escopos populados no form.
        const allRoles = Array.isArray(row.allRoles) ? row.allRoles : [];
        const leaderOrInternRole = allRoles.find((r) => r.role === "LEADER" || r.role === "INTERN");
        const preceptorRole = allRoles.find((r) => r.role === "PRECEPTOR");
        const facultyFromAll = leaderOrInternRole?.facultyId ?? null;
        const baseFromAll = preceptorRole?.baseId ?? null;
        setEditing({
          ...row,
          password: undefined,
          facultyId: facultyFromAll ?? row.facultyId ?? null,
          baseId: baseFromAll ?? row.baseId ?? null,
        });
      }
    } catch {
      /* keep lightweight row data */
    }
    if (user.role === "INTERN") loadHistory(user.id);
  }

  function toggleAccessRow(user: User) {
    if (accessRowUserId === user.id) {
      setAccessRowUserId(null);
      setAccessEmail("");
      setAccessMessage(null);
      return;
    }
    setAccessRowUserId(user.id);
    setAccessEmail(user.email ?? "");
    setAccessMessage(null);
  }

  async function save() {
    setError("");
    if (!editing) return;
    try {
      const isNew = !editing.id;

      // Constroi roles[] a partir dos checkboxes do form multi-role.
      const selected = getSelectedRoles();
      if (selected.size === 0) {
        setError("Selecione pelo menos um papel.");
        return;
      }

      const facultyIdStr = typeof editing.facultyId === "string" && editing.facultyId ? editing.facultyId : null;
      const baseIdStr = typeof editing.baseId === "string" && editing.baseId ? editing.baseId : null;

      if ((selected.has("LEADER") || selected.has("INTERN")) && !facultyIdStr) {
        setError("Faculdade obrigatória para os papéis Líder / Interno.");
        return;
      }
      if (selected.has("PRECEPTOR") && !baseIdStr) {
        setError("Base obrigatória para o papel Preceptor.");
        return;
      }

      const rolesPayload: Array<{ role: string; facultyId?: string | null; baseId?: string | null }> = [];
      for (const r of selected) {
        if (r === "LEADER" || r === "INTERN") {
          rolesPayload.push({ role: r, facultyId: facultyIdStr });
        } else if (r === "PRECEPTOR") {
          rolesPayload.push({ role: r, baseId: baseIdStr });
        } else {
          rolesPayload.push({ role: r });
        }
      }

      const {
        selfie, selfieUploadedAt, facultyAbbr, baseCode, createdAt, password,
        // removemos os campos legacy e o helper de estado selectedRoles:
        role: _legacyRole, alsoPreceptor: _legacyAlso, allRoles: _allRoles,
        selectedRoles: _selectedRoles,
        facultyId: _legacyFacultyId, baseId: _legacyBaseId,
        ...rest
      } = editing as Record<string, unknown>;
      // Referencias apenas para satisfazer o linter (valores descartados intencionalmente):
      void _legacyRole; void _legacyAlso; void _allRoles; void _selectedRoles;
      void _legacyFacultyId; void _legacyBaseId;

      const finalPayload = {
        ...rest,
        roles: rolesPayload,
        ...(typeof password === "string" && password.trim() ? { password: password.trim() } : {}),
      };

      const res = await fetch("/taximetro/api/admin/users", {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalPayload),
      });
      const json = await res.json();
      if (!json.success) { setError(json.error); return; }
      setEditing(null);
      setHistory(null);
      load();
    } catch {
      setError("Erro de conexão. Tente novamente.");
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

  async function deactivateUser(user: User) {
    const confirmed = window.confirm(`Desativar ${user.name}? O histórico será preservado, mas o login ficará bloqueado.`);
    if (!confirmed) return;
    try {
      const res = await fetch("/taximetro/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error);
        return;
      }
      if (editing?.id === user.id) {
        setEditing(null);
        setHistory(null);
      }
      load();
    } catch {
      alert("Erro de conexão.");
    }
  }

  async function toggleArchive(user: User) {
    const archive = !user.isArchived;
    const msg = archive
      ? `Arquivar ${user.name}? Ele não aparecerá mais nos relatórios e escalas.`
      : `Desarquivar ${user.name}? Ele voltará a aparecer nos relatórios e escalas.`;
    if (!window.confirm(msg)) return;
    try {
      const res = await fetch("/taximetro/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id, isArchived: archive }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error);
        return;
      }
      load();
    } catch {
      alert("Erro de conexão.");
    }
  }

  async function quickResetAccess(user: User) {
    const normalizedEmail = accessEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setAccessMessage({ type: "error", text: "Informe o email alternativo." });
      return;
    }

    const confirmed = window.confirm(`Atualizar o login de ${user.name} para ${normalizedEmail} e redefinir a senha para 123456?`);
    if (!confirmed) return;

    setAccessSaving(true);
    setAccessMessage(null);
    try {
      const res = await fetch("/taximetro/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: user.id,
          email: normalizedEmail,
          password: "123456",
          forcePasswordChange: true,
          isActive: true,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setAccessMessage({ type: "error", text: json.error || "Não foi possível redefinir o acesso." });
        return;
      }
      setAccessMessage({ type: "success", text: `Login atualizado para ${normalizedEmail}. Senha temporária definida como 123456 e troca obrigatória ativada no próximo login.` });
      await load();
    } catch {
      setAccessMessage({ type: "error", text: "Erro de conexão ao redefinir acesso." });
    } finally {
      setAccessSaving(false);
    }
  }

  function formatCpf(value: string) {
    const d = value.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  async function exportPdf() {
    if (!historyRef.current || !editing) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((el) => el.outerHTML)
      .join("");
    printWindow.document.write(`
      <!DOCTYPE html><html><head><title>Histórico — ${editing.name as string}</title>${styles}
      <style>body{padding:24px;font-family:system-ui,sans-serif}@media print{body{padding:12px}}</style>
      </head><body>${historyRef.current.innerHTML}</body></html>
    `);
    printWindow.document.close();
    printWindow.onload = () => { printWindow.print(); };
  }

  const pendingCount = users.filter((u) => !u.isActive).length;

  const searchTerm = search.trim().toLowerCase();
  const filtered = users.filter((u) => {
    if (showPending && u.isActive) return false;
    if (!searchTerm) return true;

    const haystack = [
      u.name,
      u.cpf ?? "",
      u.email,
      u.phone ?? "",
      u.registrationCode ?? "",
      u.role ?? "",
      u.facultyAbbr ?? "",
      u.baseCode ?? "",
    ].map((value) => value.toLowerCase());

    return haystack.some((value) => value.includes(searchTerm));
  });

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
              onClick={() => setShowPending(!showPending)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${showPending
                ? "bg-amber-500 text-white hover:bg-amber-600"
                : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                }`}
            >
              Pendentes ({pendingCount})
            </button>
          )}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar..." className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" />
          <button onClick={() => { setEditing({ name: "", cpf: "", email: "", phone: "", password: "", selectedRoles: ["INTERN"], facultyId: "", baseId: null, registrationCode: "" }); setHistory(null); }} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 whitespace-nowrap">
            + Novo
          </button>
        </div>
      </div>

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

      {editing && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
          <h2 className="font-semibold text-slate-900">{editing.id ? "Editar Usuário" : "Novo Usuário"}</h2>

          {/* Selfie preview for existing users */}
          {!!editing.id && !!(editing as User).selfie && (
            <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
              <img src={(editing as User).selfie!} alt="Selfie" className="h-16 w-16 rounded-full object-cover ring-2 ring-slate-200" />
              <div>
                <p className="text-xs font-medium text-slate-600">Selfie de identificação</p>
                <p className="text-[10px] text-slate-400">Enviada no cadastro</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Inp label="Nome" value={editing.name as string ?? ""} onChange={(v) => setEditing({ ...editing, name: v })} />
            <Inp label="CPF" value={editing.cpf as string ?? ""} onChange={(v) => setEditing({ ...editing, cpf: formatCpf(v) })} />
            <Inp label="Email" value={editing.email as string ?? ""} onChange={(v) => setEditing({ ...editing, email: v })} />
            <Inp label="Telefone" value={editing.phone as string ?? ""} onChange={(v) => setEditing({ ...editing, phone: v })} />
            <Inp label="Cód. Cadastro" value={editing.registrationCode as string ?? ""} onChange={(v) => setEditing({ ...editing, registrationCode: v })} />
            <Inp label={editing.id ? "Nova senha" : "Senha"} value={editing.password as string ?? ""} onChange={(v) => setEditing({ ...editing, password: v })} />
            {!!editing.id && (
              <label className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  checked={!!editing.isActive}
                  onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-accent-600"
                />
                <span className="text-sm text-slate-700">Ativo (aprovado)</span>
              </label>
            )}
          </div>

          {/* Multi-select de papeis — substituiu dropdown unico + alsoPreceptor */}
          {(() => {
            const selected = getSelectedRoles();
            const needsFaculty = selected.has("LEADER") || selected.has("INTERN");
            const needsBase = selected.has("PRECEPTOR");
            return (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                <div>
                  <span className="text-xs font-medium text-slate-500">Papéis (marque todos que se aplicam)</span>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {ROLES.map((r) => (
                      <label key={r} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm cursor-pointer transition-colors ${selected.has(r) ? "border-accent-500 bg-white" : "border-slate-200 bg-white/60"}`}>
                        <input
                          type="checkbox"
                          checked={selected.has(r)}
                          onChange={(e) => toggleRole(r, e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-accent-600"
                        />
                        <span className="text-slate-700">{ROLE_LABEL[r]}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {(needsFaculty || needsBase) && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {needsFaculty && (
                      <Sel
                        label="Faculdade (obrigatória p/ Líder e Interno)"
                        value={(editing.facultyId as string) ?? ""}
                        options={["", ...faculties.map((f) => f.id)]}
                        labels={["— selecione —", ...faculties.map((f) => f.abbreviation)]}
                        onChange={(v) => setEditing({ ...editing, facultyId: v || null })}
                      />
                    )}
                    {needsBase && (
                      <Sel
                        label="Base (obrigatória p/ Preceptor)"
                        value={(editing.baseId as string) ?? ""}
                        options={["", ...bases.map((b) => b.id)]}
                        labels={["— selecione —", ...bases.map((b) => `${b.code} · ${b.name}`)]}
                        onChange={(v) => setEditing({ ...editing, baseId: v || null })}
                      />
                    )}
                  </div>
                )}

                <p className="text-[11px] text-slate-500">
                  Remoções não apagam o histórico — a role fica desativada mas permanece em audit_log.
                </p>
              </div>
            );
          })()}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">Salvar</button>
            <button onClick={() => { setEditing(null); setHistory(null); }} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200">Cancelar</button>
            {!!editing.id && !!editing.isActive && (
              <button onClick={() => deactivateUser(editing as User)} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700">Desativar</button>
            )}
          </div>
        </div>
      )}

      {/* History section */}
      {!!editing?.id && (editing.role as string) === "INTERN" && (
        <div ref={historyRef} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">
              Histórico — {String(editing.name ?? "")}
              {!!editing.facultyAbbr && (() => {
                const fst = getFacultyStyle(editing.facultyAbbr as string);
                return (
                  <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fst.pill}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                    {editing.facultyAbbr as string}
                  </span>
                );
              })()}
            </h2>
            {history && (
              <button onClick={exportPdf} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 transition-colors">
                <FileDown className="h-3.5 w-3.5" /> Exportar PDF
              </button>
            )}
          </div>

          {historyLoading ? (
            <p className="py-6 text-center text-sm text-slate-400">Carregando histórico...</p>
          ) : history ? (
            <>
              {/* Assignments history */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Plantões ({history.assignments.length})</h3>
                {history.assignments.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-400">Nenhum plantão registrado.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                          <th className="pb-2 pr-3">Data</th>
                          <th className="pb-2 pr-3">Base</th>
                          <th className="pb-2 pr-3">Turno</th>
                          <th className="pb-2 pr-3">Resultado</th>
                          <th className="pb-2 pr-3">Check-in</th>
                          <th className="pb-2">Check-out</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.assignments.map((a) => {
                          const outcome = getRowOutcome(a);
                          return (
                            <tr key={a.id} className={`border-b border-slate-50 ${outcome.bg}`}>
                              <td className="py-1.5 pr-3 text-xs">{new Date(a.date + "T12:00:00").toLocaleDateString("pt-BR")}</td>
                              <td className="py-1.5 pr-3 text-xs font-medium">{a.base_code}</td>
                              <td className="py-1.5 pr-3 text-xs">{a.period === "DAY" ? "Diurno" : "Noturno"}</td>
                              <td className="py-1.5 pr-3"><span className="text-xs font-medium">{outcome.label}</span></td>
                              <td className="py-1.5 pr-3 text-xs text-slate-500">{a.checkin_at ? formatBrazilTime(a.checkin_at) : "—"}</td>
                              <td className="py-1.5 text-xs text-slate-500">{a.checkout_at ? formatBrazilTime(a.checkout_at) : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Requests history */}
              {history.requests.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Solicitações ({history.requests.length})</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                          <th className="pb-2 pr-3">Data</th>
                          <th className="pb-2 pr-3">Tipo</th>
                          <th className="pb-2 pr-3">Base</th>
                          <th className="pb-2 pr-3">Status</th>
                          <th className="pb-2">Observação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.requests.map((r) => (
                          <tr key={r.id} className="border-b border-slate-50">
                            <td className="py-1.5 pr-3 text-xs">{new Date(r.created_at).toLocaleDateString("pt-BR")}</td>
                            <td className="py-1.5 pr-3 text-xs font-medium">{REQ_TYPE_LABEL[r.type] ?? r.type}</td>
                            <td className="py-1.5 pr-3 text-xs">
                              {r.type === "EXTRA_SHIFT"
                                ? [r.extra_base_code, r.extra_date].filter(Boolean).join(" · ") || "—"
                                : r.base_code ?? "—"}
                            </td>
                            <td className="py-1.5 pr-3">
                              <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${REQ_STATUS_COLOR[r.status] ?? ""}`}>
                                {REQ_STATUS_LABEL[r.status] ?? r.status}
                              </span>
                            </td>
                            <td className="py-1.5 text-xs text-slate-500">{r.review_notes ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 text-[10px] text-slate-500">
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-emerald-50 border border-emerald-200" /> Presente/Finalizado</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-red-50 border border-red-200" /> Ausente</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-purple-50 border border-purple-200" /> Erro geo</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-violet-50 border border-violet-200" /> TOTP expirado</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-fuchsia-50 border border-fuchsia-200" /> Erro QR</span>
              </div>
            </>
          ) : null}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="pb-2 pr-4"></th>
              <th className="pb-2 pr-4">Nome</th>
              <th className="pb-2 pr-4">CPF</th>
              <th className="pb-2 pr-4">Papel</th>
              <th className="pb-2 pr-4">Faculdade</th>
              <th className="pb-2 pr-4">Ativo</th>
              <th className="pb-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <Fragment key={u.id}>
                <tr key={u.id} className={`border-b border-slate-100 ${!u.isActive ? "bg-amber-50/50" : ""}`}>
                  <td className="py-2 pr-2">
                    <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-xs font-medium">
                      {u.name.charAt(0)}
                    </div>
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
                          return (
                            <span
                              key={`${u.id}-${r.role}-${r.facultyId ?? ""}-${r.baseId ?? ""}-${idx}`}
                              className={`rounded px-2 py-0.5 text-xs font-medium ${ROLE_BADGE_CLASS[r.role] ?? "bg-slate-50 text-slate-700"}`}
                              title={scope ? `${ROLE_LABEL[r.role]} · ${scope}` : ROLE_LABEL[r.role]}
                            >
                              {ROLE_LABEL[r.role]}{scope ? ` · ${scope}` : ""}
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
                  <td className="py-2 flex gap-2 flex-wrap">
                    {!u.isActive && (
                      <button onClick={() => approve(u.id)} className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">Aprovar</button>
                    )}
                    <button onClick={() => toggleAccessRow(u)} className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-600">
                      <KeyRound className="h-3.5 w-3.5" />
                      Acesso
                      {accessRowUserId === u.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={() => openEdit(u)} className="text-accent-600 hover:text-accent-500">Editar</button>
                    {u.isActive && <button onClick={() => deactivateUser(u)} className="text-red-600 hover:text-red-500">Desativar</button>}
                    {u.isActive && u.role === "INTERN" && (
                      <button
                        onClick={() => toggleArchive(u)}
                        className={`inline-flex items-center gap-1 text-xs font-medium ${u.isArchived ? "text-emerald-600 hover:text-emerald-500" : "text-amber-600 hover:text-amber-500"}`}
                      >
                        {u.isArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                        {u.isArchived ? "Desarquivar" : "Arquivar"}
                      </button>
                    )}
                  </td>
                </tr>
                {accessRowUserId === u.id && (
                  <tr className="border-b border-slate-100 bg-sky-50/50">
                    <td colSpan={7} className="px-4 py-4">
                      <div className="rounded-xl border border-sky-200 bg-white p-4 shadow-sm space-y-3">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Acesso rápido</p>
                            <p className="text-xs text-slate-500">Troca o email de login, redefine a senha temporária e obriga a pessoa a cadastrar uma nova senha assim que entrar.</p>
                          </div>
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700 border border-sky-200">
                            Senha temporária: 123456
                          </span>
                        </div>

                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                          <label className="block">
                            <span className="text-xs text-slate-500">Novo email de login</span>
                            <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                              <Mail className="h-4 w-4 text-slate-400" />
                              <input
                                value={accessEmail}
                                onChange={(e) => setAccessEmail(e.target.value)}
                                placeholder="email alternativo informado pelo interno"
                                className="w-full bg-transparent text-sm text-slate-900 outline-none"
                              />
                            </div>
                          </label>

                          <button
                            onClick={() => quickResetAccess(u)}
                            disabled={accessSaving}
                            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {accessSaving ? "Aplicando..." : "Trocar login e resetar senha"}
                          </button>
                        </div>

                        {accessMessage && (
                          <div className={`rounded-lg px-3 py-2 text-sm ${accessMessage.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                            {accessMessage.text}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="py-8 text-center text-slate-500">Nenhum usuário encontrado.</p>}
      </div>
    </div>
  );
}

function Inp({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" />
    </label>
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
