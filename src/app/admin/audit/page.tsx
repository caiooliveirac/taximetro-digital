"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { TableSkeleton } from "@/components/table-skeleton";

type AuditEntry = {
  id: string;
  userId: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string | null;
  detail: string | null;
  createdAt: string;
};

const ACTION_VARIANT: Record<string, "confirmed" | "pending" | "absent" | "checkedout" | "default"> = {
  CHECKIN_VALIDATED_APP: "confirmed",
  CHECKIN_VALIDATED_CODE: "confirmed",
  CHECKIN_VALIDATED_TELEGRAM: "confirmed",
  CHECKOUT_CONFIRMED: "checkedout",
  ASSIGNMENT_CREATED: "confirmed",
  ASSIGNMENT_UPDATED: "pending",
  REQUEST_APPROVED: "confirmed",
  REQUEST_REJECTED: "absent",
  REVIEW_REQUEST_APPROVED: "confirmed",
  REVIEW_REQUEST_REJECTED: "absent",
  CREATE_ASSIGNMENT: "confirmed",
  UPDATE_ASSIGNMENT: "pending",
  CREATE_USER: "confirmed",
  CREATE_BASE: "confirmed",
  CREATE_FACULTY: "confirmed",
  CREATE_SLOT_RULE: "confirmed",
  DELETE_SLOT_RULE: "absent",
  TELEGRAM_BINDING: "confirmed",
  CREATE_INVITE: "confirmed",
  VALIDATE_WRONG_BASE: "absent",
  VALIDATE_WRONG_BASE_TELEGRAM: "absent",
  VALIDATE_RATE_LIMITED: "absent",
  GEO_VIOLATION: "absent",
  TOTP_EXPIRED: "absent",
};

const ACTION_LABEL: Record<string, string> = {
  SELF_REGISTER: "Auto-cadastro",
  LOGIN: "Login",
  CHECKIN_GPS: "Check-in GPS",
  CHECKIN_VALIDATED_APP: "Check-in Validado (App)",
  CHECKIN_VALIDATED_CODE: "Check-in Validado (Código)",
  CHECKIN_VALIDATED_TELEGRAM: "Check-in Validado (Telegram)",
  CHECKOUT_CONFIRMED: "Check-out Confirmado",
  ASSIGNMENT_CREATED: "Alocação Criada",
  ASSIGNMENT_UPDATED: "Alocação Atualizada",
  CREATE_ASSIGNMENT: "Alocação Criada",
  UPDATE_ASSIGNMENT: "Alocação Atualizada",
  REQUEST_CREATED: "Solicitação Criada",
  REQUEST_APPROVED: "Solicitação Aprovada",
  REQUEST_REJECTED: "Solicitação Rejeitada",
  REQUEST_ESCALATED: "Solicitação Escalada",
  CREATE_REQUEST: "Solicitação Criada",
  REVIEW_REQUEST_APPROVED: "Solicitação Aprovada",
  REVIEW_REQUEST_REJECTED: "Solicitação Rejeitada",
  USER_CREATED: "Usuário Criado",
  USER_UPDATED: "Usuário Atualizado",
  CREATE_USER: "Usuário Criado",
  UPDATE_USER: "Usuário Atualizado",
  BASE_CREATED: "Base Criada",
  BASE_UPDATED: "Base Atualizada",
  CREATE_BASE: "Base Criada",
  UPDATE_BASE: "Base Atualizada",
  CALIBRATE_BASE: "Base Calibrada",
  RULE_CREATED: "Regra Criada",
  RULE_UPDATED: "Regra Atualizada",
  CREATE_SLOT_RULE: "Regra de Vaga Criada",
  UPDATE_SLOT_RULE: "Regra de Vaga Atualizada",
  DELETE_SLOT_RULE: "Regra de Vaga Removida",
  CREATE_FACULTY: "Faculdade Criada",
  UPDATE_FACULTY: "Faculdade Atualizada",
  TOTP_EXPIRED: "TOTP Expirado",
  GEO_VIOLATION: "Violação de Geolocalização",
  VALIDATE_WRONG_BASE: "Validação Base Incorreta",
  VALIDATE_WRONG_BASE_TELEGRAM: "Validação Base Incorreta (Telegram)",
  VALIDATE_RATE_LIMITED: "Validação Bloqueada (Rate Limit)",
  TELEGRAM_BINDING: "Vinculação Telegram",
  CREATE_INVITE: "Convite Criado",
  DEACTIVATE_INVITE: "Convite Desativado",
};

const ENTITY_LABEL: Record<string, string> = {
  assignment: "Alocação",
  checkin: "Check-in",
  checkout: "Check-out",
  user: "Usuário",
  request: "Solicitação",
  base: "Base",
  rule: "Regra",
  slot_rule: "Regra de Vaga",
  faculty: "Faculdade",
  totp: "TOTP",
  session: "Sessão",
  telegram_binding: "Telegram",
  invite_link: "Convite",
};

export default function AdminAudit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");

  useEffect(() => {
    fetch("/taximetro/api/admin/audit")
      .then((r) => r.json())
      .then((json) => { if (json.success) setEntries(json.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const actions = [...new Set(entries.map((e) => e.action))].sort();
  const entities = [...new Set(entries.map((e) => e.entity).filter(Boolean))].sort();

  const filtered = entries.filter((e) =>
    (!search || e.userName?.toLowerCase().includes(search.toLowerCase()) || e.action.toLowerCase().includes(search.toLowerCase())) &&
    (!filterAction || e.action === filterAction) &&
    (!filterEntity || e.entity === filterEntity)
  );

  const selectCls = "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Registro de Atividades</h1>
        <span className="text-xs text-slate-400">{entries.length} registros</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input placeholder="Buscar por usuário ou ação..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className={selectCls}>
          <option value="">Todas ações</option>
          {actions.map((a) => <option key={a} value={a}>{ACTION_LABEL[a] ?? a}</option>)}
        </select>
        <select value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)} className={selectCls}>
          <option value="">Todas entidades</option>
          {entities.map((e) => <option key={e} value={e}>{ENTITY_LABEL[e] ?? e}</option>)}
        </select>
      </div>

      {loading ? (
        <TableSkeleton rows={8} cols={5} />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Entidade</TableHead>
                <TableHead>Detalhe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs text-slate-500">{new Date(e.createdAt).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="font-medium">{e.userName}</TableCell>
                  <TableCell>
                    <Badge variant={ACTION_VARIANT[e.action] ?? "default"} className="text-[11px]">{ACTION_LABEL[e.action] ?? e.action}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">{ENTITY_LABEL[e.entity] ?? e.entity}{e.entityId ? ` #${e.entityId.slice(0, 8)}` : ""}</TableCell>
                  <TableCell className="text-xs text-slate-500">{e.detail ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nenhum registro encontrado.</p>}
          <div className="border-t border-slate-100 px-4 py-2">
            <p className="text-xs text-slate-400">{filtered.length} de {entries.length} registros</p>
          </div>
        </div>
      )}
    </div>
  );
}
