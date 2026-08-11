"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileDown, Mail, X, Archive, ArchiveRestore, Pencil } from "lucide-react";
import { getFacultyStyle } from "@/lib/base-colors";
import { formatBrazilTime } from "@/lib/utils";
import { PhotoLightbox } from "@/components/photo-lightbox";
import {
  ROLES, ROLE_LABEL, ROLE_BADGE_CLASS, getRowOutcome,
  REQ_TYPE_LABEL, REQ_STATUS_LABEL, REQ_STATUS_COLOR, formatCpf,
  type User, type Faculty, type Base, type HistoryAssignment, type HistoryRequest,
} from "@/app/admin/usuarios/user-meta";

type RoleName = "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN";

type UserDrawerProps = {
  userId: string; // "new" = criação
  initialUser?: User; // linha leve da lista, para render imediato
  faculties: Faculty[];
  bases: Base[];
  prevId?: string | null;
  nextId?: string | null;
  position?: string; // ex.: "3 de 41"
  onNavigate: (id: string) => void;
  onClose: () => void;
  onChanged: () => void;
};

const EMPTY_FORM = { name: "", cpf: "", email: "", phone: "", password: "", selectedRoles: ["INTERN"], facultyId: "", baseId: null, registrationCode: "" };

export function UserDrawer({ userId, initialUser, faculties, bases, prevId, nextId, position, onNavigate, onClose, onChanged }: UserDrawerProps) {
  const isCreate = userId === "new";
  const [detail, setDetail] = useState<User | null>(initialUser ?? null);
  const [mode, setMode] = useState<"view" | "edit">(isCreate ? "edit" : "view");
  const [form, setForm] = useState<Record<string, unknown> | null>(isCreate ? { ...EMPTY_FORM } : null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<{ assignments: HistoryAssignment[]; requests: HistoryRequest[] } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [accessEmail, setAccessEmail] = useState("");
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessMessage, setAccessMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  const isIntern = detail?.role === "INTERN" || detail?.allRoles?.some((r) => r.role === "INTERN") || false;

  async function fetchDetail(id: string) {
    try {
      const res = await fetch(`/taximetro/api/admin/users?id=${id}&includeSelfie=1`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data) && json.data[0]) {
        setDetail(json.data[0] as User);
        return json.data[0] as User;
      }
    } catch { /* mantém dados leves */ }
    return null;
  }

  useEffect(() => {
    setMode(isCreate ? "edit" : "view");
    setForm(isCreate ? { ...EMPTY_FORM } : null);
    setError("");
    setHistory(null);
    setAccessMessage(null);
    setLightbox(false);
    if (isCreate) { setDetail(null); return; }
    setDetail(initialUser ?? null);
    setAccessEmail(initialUser?.email ?? "");
    fetchDetail(userId).then((d) => { if (d) setAccessEmail(d.email ?? ""); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (isCreate || !isIntern) return;
    let cancelled = false;
    setHistoryLoading(true);
    fetch(`/taximetro/api/admin/users/${userId}/history`)
      .then((r) => r.json())
      .then((json) => { if (!cancelled && json.success) setHistory(json.data); })
      .catch(() => { if (!cancelled) setHistory(null); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, isIntern]);

  // Trava o scroll da lista enquanto o drawer está aberto.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (lightbox) return; // lightbox trata o próprio Esc
      if (e.key === "Escape") {
        if (mode === "edit" && !isCreate) { setMode("view"); setError(""); }
        else onClose();
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (mode !== "view") return;
      if (e.key === "ArrowLeft" && prevId) onNavigate(prevId);
      if (e.key === "ArrowRight" && nextId) onNavigate(nextId);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, mode, isCreate, prevId, nextId, onNavigate, onClose]);

  function getSelectedRoles(): Set<RoleName> {
    if (!form) return new Set();
    const fromState = form.selectedRoles;
    if (Array.isArray(fromState)) return new Set(fromState as RoleName[]);
    const allRoles = form.allRoles as User["allRoles"];
    if (Array.isArray(allRoles) && allRoles.length > 0) return new Set(allRoles.map((r) => r.role));
    const legacyRole = form.role as RoleName | undefined;
    const set = new Set<RoleName>();
    if (legacyRole) set.add(legacyRole);
    if (form.alsoPreceptor) set.add("PRECEPTOR");
    if (legacyRole === "COORDINATOR") set.add("PRECEPTOR");
    return set;
  }

  function toggleRole(role: RoleName, checked: boolean) {
    if (!form) return;
    const current = getSelectedRoles();
    if (checked) current.add(role);
    else current.delete(role);
    const needsFaculty = current.has("LEADER") || current.has("INTERN");
    const needsBase = current.has("PRECEPTOR");
    setForm({
      ...form,
      selectedRoles: Array.from(current),
      facultyId: needsFaculty ? (form.facultyId ?? null) : null,
      baseId: needsBase ? (form.baseId ?? null) : null,
    });
  }

  function startEdit() {
    if (!detail) return;
    setForm({ ...detail, password: undefined });
    setError("");
    setMode("edit");
  }

  async function save() {
    setError("");
    if (!form) return;
    const selected = getSelectedRoles();
    if (selected.size === 0) { setError("Selecione pelo menos um papel."); return; }

    const facultyIdStr = typeof form.facultyId === "string" && form.facultyId ? form.facultyId : null;
    const baseIdStr = typeof form.baseId === "string" && form.baseId ? form.baseId : null;
    if ((selected.has("LEADER") || selected.has("INTERN")) && !facultyIdStr) {
      setError("Faculdade obrigatória para os papéis Líder / Interno.");
      return;
    }

    const rolesPayload: Array<{ role: string; facultyId?: string | null; baseId?: string | null }> = [];
    for (const r of selected) {
      if (r === "LEADER" || r === "INTERN") rolesPayload.push({ role: r, facultyId: facultyIdStr });
      else if (r === "PRECEPTOR") rolesPayload.push({ role: r, baseId: baseIdStr });
      else rolesPayload.push({ role: r });
    }

    const {
      selfie, selfieUploadedAt, facultyAbbr, baseCode, createdAt, password,
      role: _legacyRole, alsoPreceptor: _legacyAlso, allRoles: _allRoles,
      selectedRoles: _selectedRoles, facultyId: _legacyFacultyId, baseId: _legacyBaseId,
      ...rest
    } = form as Record<string, unknown>;
    void selfie; void selfieUploadedAt; void facultyAbbr; void baseCode; void createdAt;
    void _legacyRole; void _legacyAlso; void _allRoles; void _selectedRoles;
    void _legacyFacultyId; void _legacyBaseId;

    const finalPayload = {
      ...rest,
      roles: rolesPayload,
      ...(typeof password === "string" && password.trim() ? { password: password.trim() } : {}),
    };

    try {
      const res = await fetch("/taximetro/api/admin/users", {
        method: isCreate ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalPayload),
      });
      const json = await res.json();
      if (!json.success) { setError(json.error); return; }
      onChanged();
      if (isCreate) { onClose(); return; }
      setMode("view");
      fetchDetail(userId);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    }
  }

  async function patchUser(body: Record<string, unknown>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      const res = await fetch("/taximetro/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, ...body }),
      });
      const json = await res.json();
      if (!json.success) { alert(json.error); return; }
      onChanged();
      fetchDetail(userId);
    } catch {
      alert("Erro de conexão.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!detail) return;
    if (!window.confirm(`Desativar ${detail.name}? O histórico será preservado, mas o login ficará bloqueado.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/taximetro/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId }),
      });
      const json = await res.json();
      if (!json.success) { alert(json.error); return; }
      onChanged();
      fetchDetail(userId);
    } catch {
      alert("Erro de conexão.");
    } finally {
      setBusy(false);
    }
  }

  async function quickResetAccess() {
    if (!detail) return;
    const normalizedEmail = accessEmail.trim().toLowerCase();
    if (!normalizedEmail) { setAccessMessage({ type: "error", text: "Informe o email alternativo." }); return; }
    if (!window.confirm(`Atualizar o login de ${detail.name} para ${normalizedEmail} e redefinir a senha para 123456?`)) return;
    setAccessSaving(true);
    setAccessMessage(null);
    try {
      const res = await fetch("/taximetro/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, email: normalizedEmail, password: "123456", forcePasswordChange: true, isActive: true }),
      });
      const json = await res.json();
      if (!json.success) {
        setAccessMessage({ type: "error", text: json.error || "Não foi possível redefinir o acesso." });
        return;
      }
      setAccessMessage({ type: "success", text: `Login atualizado para ${normalizedEmail}. Senha temporária definida como 123456 e troca obrigatória ativada no próximo login.` });
      onChanged();
      fetchDetail(userId);
    } catch {
      setAccessMessage({ type: "error", text: "Erro de conexão ao redefinir acesso." });
    } finally {
      setAccessSaving(false);
    }
  }

  async function exportPdf() {
    if (!historyRef.current || !detail) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((el) => el.outerHTML)
      .join("");
    printWindow.document.write(`
      <!DOCTYPE html><html><head><title>Histórico — ${detail.name}</title>${styles}
      <style>body{padding:24px;font-family:system-ui,sans-serif}@media print{body{padding:12px}}</style>
      </head><body>${historyRef.current.innerHTML}</body></html>
    `);
    printWindow.document.close();
    printWindow.onload = () => { printWindow.print(); };
  }

  const selected = getSelectedRoles();
  const needsFaculty = selected.has("LEADER") || selected.has("INTERN");
  const needsBase = selected.has("PRECEPTOR");
  const internRole = detail?.allRoles?.find((r) => r.role === "INTERN");

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={isCreate ? "Novo usuário" : `Detalhes de ${detail?.name ?? "usuário"}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl sm:max-w-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {!isCreate && (
              <>
                <button
                  onClick={() => prevId && onNavigate(prevId)}
                  disabled={!prevId}
                  aria-label="Usuário anterior"
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  onClick={() => nextId && onNavigate(nextId)}
                  disabled={!nextId}
                  aria-label="Próximo usuário"
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                {position && <span className="text-xs text-slate-400 whitespace-nowrap">{position}</span>}
              </>
            )}
            {isCreate && <h2 className="truncate font-semibold text-slate-900">Novo usuário</h2>}
          </div>
          <button onClick={onClose} aria-label="Fechar" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {mode === "view" && detail && (
            <>
              {/* Foto + identidade */}
              <div className="flex flex-col items-center gap-3 text-center">
                {detail.selfie ? (
                  <button onClick={() => setLightbox(true)} className="cursor-zoom-in" aria-label="Ampliar foto">
                    <img src={detail.selfie} alt={`Foto de ${detail.name}`} className="h-40 w-40 rounded-2xl object-cover ring-2 ring-slate-200" />
                  </button>
                ) : (
                  <div className="flex h-40 w-40 items-center justify-center rounded-2xl bg-slate-100 text-5xl font-medium text-slate-400">
                    {detail.name.charAt(0)}
                  </div>
                )}
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{detail.name}</h2>
                  <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
                    {(detail.allRoles && detail.allRoles.length > 0 ? detail.allRoles : []).map((r, idx) => {
                      const scope = r.role === "LEADER" || r.role === "INTERN" ? r.facultyAbbr : r.role === "PRECEPTOR" ? r.baseCode : null;
                      const cohortTag = r.role === "INTERN" && r.cohortName ? ` (${r.cohortName})` : "";
                      return (
                        <span key={`${r.role}-${idx}`} className={`rounded px-2 py-0.5 text-xs font-medium ${ROLE_BADGE_CLASS[r.role] ?? "bg-slate-50 text-slate-700"}`}>
                          {ROLE_LABEL[r.role]}{scope ? ` · ${scope}` : ""}{cohortTag}
                        </span>
                      );
                    })}
                    {(!detail.allRoles || detail.allRoles.length === 0) && (
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${ROLE_BADGE_CLASS[detail.role ?? ""] ?? "bg-slate-50 text-slate-700"}`}>
                        {ROLE_LABEL[detail.role ?? ""] ?? detail.role ?? "—"}
                      </span>
                    )}
                    {detail.isActive ? (
                      detail.isArchived ? (
                        <span className="rounded px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600">Arquivado</span>
                      ) : (
                        <span className="rounded px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700">Ativo</span>
                      )
                    ) : (
                      <span className="rounded px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700">Pendente</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Dados */}
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-sm sm:grid-cols-2">
                <Field label="CPF" value={detail.cpf || "—"} mono />
                <Field label="Email" value={detail.email || "—"} />
                <Field label="Telefone" value={detail.phone || "—"} />
                <Field label="Cód. cadastro" value={detail.registrationCode || "—"} />
                <Field label="Faculdade" value={detail.facultyAbbr || "—"} />
                <Field label="Turma" value={internRole?.cohortName || "—"} />
                <Field label="Cadastro em" value={detail.createdAt ? new Date(detail.createdAt).toLocaleDateString("pt-BR") : "—"} />
              </dl>

              {/* Ações */}
              <div className="flex flex-wrap gap-2">
                <button onClick={startEdit} className="inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-white hover:bg-accent-600">
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </button>
                {!detail.isActive && (
                  <button onClick={() => patchUser({ isActive: true })} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                    Aprovar
                  </button>
                )}
                {detail.isActive && isIntern && (
                  <button
                    onClick={() => patchUser(
                      { isArchived: !detail.isArchived },
                      detail.isArchived
                        ? `Desarquivar ${detail.name}? Ele voltará a aparecer nos relatórios e escalas.`
                        : `Arquivar ${detail.name}? Ele não aparecerá mais nos relatórios e escalas.`,
                    )}
                    disabled={busy}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-60 ${detail.isArchived ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-amber-50 text-amber-700 hover:bg-amber-100"}`}
                  >
                    {detail.isArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                    {detail.isArchived ? "Desarquivar" : "Arquivar"}
                  </button>
                )}
                {detail.isActive && (
                  <button onClick={deactivate} disabled={busy} className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60">
                    Desativar
                  </button>
                )}
              </div>

              {/* Acesso rápido */}
              <details className="rounded-xl border border-sky-200 bg-sky-50/40">
                <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold text-sky-900">Acesso rápido (trocar login / resetar senha)</summary>
                <div className="space-y-3 border-t border-sky-200 p-3">
                  <p className="text-xs text-slate-500">Troca o email de login, redefine a senha temporária (123456) e obriga a pessoa a cadastrar uma nova senha assim que entrar.</p>
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
                    onClick={quickResetAccess}
                    disabled={accessSaving}
                    className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {accessSaving ? "Aplicando..." : "Trocar login e resetar senha"}
                  </button>
                  {accessMessage && (
                    <div className={`rounded-lg px-3 py-2 text-sm ${accessMessage.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                      {accessMessage.text}
                    </div>
                  )}
                </div>
              </details>

              {/* Histórico (interno) */}
              {isIntern && (
                <div ref={historyRef} className="rounded-xl border border-slate-200 bg-white p-3 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900">
                      Histórico
                      {!!detail.facultyAbbr && (() => {
                        const fst = getFacultyStyle(detail.facultyAbbr);
                        return (
                          <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fst.pill}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                            {detail.facultyAbbr}
                          </span>
                        );
                      })()}
                    </h3>
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
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Plantões ({history.assignments.length})</h4>
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

                      {history.requests.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Solicitações ({history.requests.length})</h4>
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
            </>
          )}

          {mode === "view" && !detail && (
            <p className="py-10 text-center text-sm text-slate-400">Carregando...</p>
          )}

          {mode === "edit" && form && (
            <div className="space-y-3">
              <h2 className="font-semibold text-slate-900">{isCreate ? "Novo Usuário" : "Editar Usuário"}</h2>

              {!isCreate && !!detail?.selfie && (
                <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                  <img src={detail.selfie} alt="Selfie" className="h-16 w-16 rounded-full object-cover ring-2 ring-slate-200" />
                  <div>
                    <p className="text-xs font-medium text-slate-600">Selfie de identificação</p>
                    <p className="text-[10px] text-slate-400">Enviada no cadastro</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Inp label="Nome" value={form.name as string ?? ""} onChange={(v) => setForm({ ...form, name: v })} />
                <Inp label="CPF" value={form.cpf as string ?? ""} onChange={(v) => setForm({ ...form, cpf: formatCpf(v) })} />
                <Inp label="Email" value={form.email as string ?? ""} onChange={(v) => setForm({ ...form, email: v })} />
                <Inp label="Telefone" value={form.phone as string ?? ""} onChange={(v) => setForm({ ...form, phone: v })} />
                <Inp label="Cód. Cadastro" value={form.registrationCode as string ?? ""} onChange={(v) => setForm({ ...form, registrationCode: v })} />
                <Inp label={isCreate ? "Senha" : "Nova senha"} value={form.password as string ?? ""} onChange={(v) => setForm({ ...form, password: v })} />
                {!isCreate && (
                  <label className="flex items-center gap-2 pt-5">
                    <input
                      type="checkbox"
                      checked={!!form.isActive}
                      onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-accent-600"
                    />
                    <span className="text-sm text-slate-700">Ativo (aprovado)</span>
                  </label>
                )}
              </div>

              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                <div>
                  <span className="text-xs font-medium text-slate-500">Papéis (marque todos que se aplicam)</span>
                  <div className="mt-2 grid grid-cols-2 gap-2">
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
                  <div className="grid grid-cols-1 gap-3">
                    {needsFaculty && (
                      <Sel
                        label="Faculdade (obrigatória p/ Líder e Interno)"
                        value={(form.facultyId as string) ?? ""}
                        options={["", ...faculties.map((f) => f.id)]}
                        labels={["— selecione —", ...faculties.map((f) => f.abbreviation)]}
                        onChange={(v) => setForm({ ...form, facultyId: v || null })}
                      />
                    )}
                    {needsBase && (
                      <Sel
                        label="Base (opcional p/ Preceptor)"
                        value={(form.baseId as string) ?? ""}
                        options={["", ...bases.map((b) => b.id)]}
                        labels={["— selecione —", ...bases.map((b) => `${b.code} · ${b.name}`)]}
                        onChange={(v) => setForm({ ...form, baseId: v || null })}
                      />
                    )}
                  </div>
                )}

                <p className="text-[11px] text-slate-500">
                  Remoções não apagam o histórico — a role fica desativada mas permanece em audit_log.
                </p>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button onClick={save} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">Salvar</button>
                <button
                  onClick={() => { if (isCreate) onClose(); else { setMode("view"); setError(""); } }}
                  className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {lightbox && detail?.selfie && (
        <PhotoLightbox src={detail.selfie} alt={`Foto de ${detail.name}`} onClose={() => setLightbox(false)} />
      )}
    </>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
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
