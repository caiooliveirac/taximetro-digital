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

function formatDetail(action: string, payload: Record<string, unknown> | null, ipAddress: string | null) {
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
