import { listRecentAuditRows } from "@/features/audit/infra/repositories/audit-repository";

function reasonLabel(reason: string | null | undefined) {
  switch (reason) {
    case "MISSING_CREDENTIALS":
      return "campos obrigatórios ausentes";
    case "USER_NOT_FOUND":
      return "usuário não encontrado";
    case "USER_INACTIVE":
      return "cadastro inativo ou ainda não aprovado";
    case "PASSWORD_NOT_SET":
      return "usuário sem senha cadastrada";
    case "INVALID_PASSWORD":
      return "senha incorreta";
    case "NO_ACTIVE_ROLE":
      return "sem papel ativo para entrar";
    default:
      return reason ?? "motivo não informado";
  }
}

function reasonGuidance(reason: string | null | undefined) {
  switch (reason) {
    case "USER_INACTIVE":
      return "Ação: aprovar ou reativar o cadastro em Usuários.";
    case "PASSWORD_NOT_SET":
      return "Ação: definir senha ou orientar login por Google, se aplicável.";
    case "INVALID_PASSWORD":
      return "Ação: orientar Esqueci minha senha ou usar reset rápido em Usuários > Acesso.";
    case "NO_ACTIVE_ROLE":
      return "Ação: revisar papéis ativos do usuário.";
    case "USER_NOT_FOUND":
      return "Ação: confirmar o email/CPF informado e se o cadastro já existe.";
    default:
      return null;
  }
}

const PERIODO: Record<string, string> = { DAY: "diurno", NIGHT: "noturno" };
function dataBr(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
    : "data não informada";
}
function turno(value: unknown) {
  return typeof value === "string" ? PERIODO[value] ?? value.toLowerCase() : "";
}
function texto(value: unknown, fallback: string) {
  return typeof value === "string" && value ? value : fallback;
}

/** Vaga liberada / vaga livre: frases em português, sem id nem sigla de banco. */
function formatVagaLivre(action: string, payload: Record<string, unknown> | null) {
  const fac = texto(payload?.facultyAbbr, "a faculdade");
  const quando = `${dataBr(payload?.date)} ${turno(payload?.period)}`.trim();

  if (action === "SLOTS_RELEASED") {
    const n = Number(payload?.created ?? 0);
    const escopo = payload?.scope === "ALL" ? "de intervenção e regulação" : "de intervenção";
    const bases = Array.isArray(payload?.bases) && payload.bases.length > 0 ? ` (${payload.bases.join(", ")})` : "";
    const removidos = Array.isArray(payload?.removedInterns) && payload.removedInterns.length > 0
      ? ` Saíram da escala: ${payload.removedInterns.join(", ")}.`
      : "";
    return `${fac} liberou ${n} vaga${n === 1 ? "" : "s"} ${escopo} em ${quando}${bases}. Ficam fora do sorteio e livres para as outras faculdades.${removidos}`;
  }
  if (action === "SLOTS_RELEASE_UNDONE") {
    const n = Number(payload?.cancelled ?? 0);
    const quandoOuVaga = payload?.date ? ` em ${quando}` : "";
    return `${fac} desfez a liberação de ${n} vaga${n === 1 ? "" : "s"}${quandoOuVaga}. Voltam para o sorteio dela.`;
  }
  if (action === "FREE_SLOT_USED") {
    const interno = texto(payload?.internName, "um interno");
    const de = texto(payload?.facultyAbbr, "outra faculdade");
    const liberou = texto(payload?.releasedByAbbr, "outra faculdade");
    const base = texto(payload?.baseCode, "base");
    return `${interno} (${de}) foi escalado na vaga livre que a ${liberou} liberou: ${base}, ${quando}.`;
  }
  return null;
}

function formatDetail(action: string, payload: Record<string, unknown> | null, ipAddress: string | null) {
  const vagaLivre = formatVagaLivre(action, payload);
  if (vagaLivre) return vagaLivre;

  if (action === "LOGIN_CREDENTIALS_FAILED") {
    const identifierType = payload?.identifierType === "CPF" ? "CPF" : "Email";
    const maskedIdentifier = typeof payload?.maskedIdentifier === "string" ? payload.maskedIdentifier : "***";
    const reason = reasonLabel(typeof payload?.reason === "string" ? payload.reason : null);
    const guidance = reasonGuidance(typeof payload?.reason === "string" ? payload.reason : null);
    return [
      `${identifierType} ${maskedIdentifier}: ${reason}.`,
      guidance,
      ipAddress ? `IP ${ipAddress}.` : null,
    ].filter(Boolean).join(" ");
  }

  if (action === "LOGIN_CREDENTIALS_SUCCESS") {
    const maskedIdentifier = typeof payload?.maskedIdentifier === "string" ? payload.maskedIdentifier : "***";
    const role = typeof payload?.role === "string" ? payload.role : "—";
    return [
      `Acesso liberado para ${maskedIdentifier}.`,
      `Papel: ${role}.`,
      ipAddress ? `IP ${ipAddress}.` : null,
    ].filter(Boolean).join(" ");
  }

  if (action === "PASSWORD_RESET_EMAIL_FAILED") {
    const diagnostic = typeof payload?.diagnostic === "string" ? payload.diagnostic : null;
    const email = typeof payload?.email === "string" ? payload.email : "***";
    return [`Falha ao enviar reset para ${email}.`, diagnostic, ipAddress ? `IP ${ipAddress}.` : null].filter(Boolean).join(" ");
  }

  if (action === "PASSWORD_RESET_EMAIL_SENT") {
    const email = typeof payload?.email === "string" ? payload.email : "***";
    return [`Link de reset enviado para ${email}.`, ipAddress ? `IP ${ipAddress}.` : null].filter(Boolean).join(" ");
  }

  return ipAddress;
}

function fallbackUserName(action: string, payload: Record<string, unknown> | null) {
  if (action.startsWith("LOGIN_CREDENTIALS_")) {
    return typeof payload?.maskedIdentifier === "string" ? payload.maskedIdentifier : "Tentativa de login";
  }

  return "Sistema";
}

export async function executeListAuditLog() {
  const rows = await listRecentAuditRows();

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    userName: row.userName ?? fallbackUserName(row.action, row.payload as Record<string, unknown> | null),
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    detail: formatDetail(row.action, row.payload as Record<string, unknown> | null, row.ipAddress),
    createdAt: row.createdAt,
  }));
}
