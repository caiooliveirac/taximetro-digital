import nodemailer, { type Transporter } from "nodemailer";

type EmailErrorCode =
  | "SMTP_NOT_CONFIGURED"
  | "SMTP_INVALID_CONFIG"
  | "SMTP_DNS_ERROR"
  | "SMTP_CONNECTION_ERROR"
  | "SMTP_TIMEOUT"
  | "SMTP_TLS_ERROR"
  | "SMTP_AUTH_ERROR"
  | "SMTP_SEND_ERROR";

type EmailErrorSummary = {
  code: EmailErrorCode;
  message: string;
  statusCode: number;
  retryable: boolean;
  diagnostic: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  rejectUnauthorized: boolean;
  user: string;
  pass: string;
  from: string;
};

class EmailDeliveryError extends Error {
  constructor(
    readonly code: EmailErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

const DEFAULT_FROM = "Taxímetro Digital <noreply@mnrs.com.br>";

let transporterPromise: Promise<Transporter> | null = null;
let verifiedTransporter: Transporter | null = null;

function maskValue(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 4) return "***";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return maskValue(email);
  const safeLocal = local.length <= 2 ? "***" : `${local.slice(0, 2)}***`;
  return `${safeLocal}@${domain}`;
}

function getResetBaseUrl() {
  const configuredBaseUrl = process.env.NEXTAUTH_URL ?? process.env.AUTH_URL;
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/$/, "");
  }

  console.warn("[email] NEXTAUTH_URL/AUTH_URL ausente; usando fallback https://mnrs.com.br para links de redefinição.");
  return "https://mnrs.com.br";
}

function getSmtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM?.trim() || DEFAULT_FROM;

  if (!host || !portRaw || !user || !pass) {
    throw new EmailDeliveryError(
      "SMTP_NOT_CONFIGURED",
      "Serviço de e-mail não configurado.",
      {
        smtpHostConfigured: Boolean(host),
        smtpPortConfigured: Boolean(portRaw),
        smtpUserConfigured: Boolean(user),
        smtpPassConfigured: Boolean(pass),
        smtpFrom: from,
        authUrlConfigured: Boolean(process.env.NEXTAUTH_URL ?? process.env.AUTH_URL),
      },
    );
  }

  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new EmailDeliveryError(
      "SMTP_INVALID_CONFIG",
      "Configuração SMTP inválida.",
      { smtpHost: host, smtpPort: portRaw },
    );
  }

  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465;

  return {
    host,
    port,
    secure,
    requireTls: process.env.SMTP_REQUIRE_TLS === "true",
    rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
    user,
    pass,
    from,
  };
}

function classifyEmailError(error: unknown): EmailErrorCode {
  if (error instanceof EmailDeliveryError) return error.code;

  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message).toLowerCase() : "";
  const response = typeof error === "object" && error !== null && "response" in error ? String(error.response).toLowerCase() : "";

  if (["EAUTH", "535", "534"].includes(code) || response.includes("auth")) return "SMTP_AUTH_ERROR";
  if (["ESOCKET", "ECONNECTION", "ECONNREFUSED", "ECONNRESET"].includes(code)) return "SMTP_CONNECTION_ERROR";
  if (["ETIMEDOUT", "ETIME"].includes(code) || message.includes("timeout")) return "SMTP_TIMEOUT";
  if (["EDNS", "ENOTFOUND", "EAI_AGAIN"].includes(code) || message.includes("getaddrinfo")) return "SMTP_DNS_ERROR";
  if (["ETLS"].includes(code) || message.includes("tls") || message.includes("certificate")) return "SMTP_TLS_ERROR";
  return "SMTP_SEND_ERROR";
}

function normalizeEmailError(error: unknown, details?: Record<string, unknown>) {
  if (error instanceof EmailDeliveryError) return error;

  const code = classifyEmailError(error);

  return new EmailDeliveryError(code, "Falha ao enviar e-mail.", details, error);
}

function logEmailEvent(stage: "verify" | "send", config: SmtpConfig, error?: EmailDeliveryError) {
  const payload = {
    stage,
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTls: config.requireTls,
    rejectUnauthorized: config.rejectUnauthorized,
    user: maskEmail(config.user),
    from: config.from,
    ...(error ? { errorCode: error.code, errorMessage: error.message, details: error.details } : {}),
  };

  if (error) {
    console.error("[email] SMTP failure", payload);
    return;
  }

  console.info("[email] SMTP ready", payload);
}

async function getVerifiedTransporter() {
  if (verifiedTransporter) return verifiedTransporter;

  if (!transporterPromise) {
    transporterPromise = (async () => {
      const config = getSmtpConfig();
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: config.requireTls,
        auth: {
          user: config.user,
          pass: config.pass,
        },
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        tls: {
          rejectUnauthorized: config.rejectUnauthorized,
        },
      });

      try {
        await transporter.verify();
        verifiedTransporter = transporter;
        logEmailEvent("verify", config);
        return transporter;
      } catch (error) {
        const normalizedError = normalizeEmailError(error, {
          host: config.host,
          port: config.port,
          secure: config.secure,
          requireTls: config.requireTls,
          user: maskEmail(config.user),
        });
        logEmailEvent("verify", config, normalizedError);
        throw normalizedError;
      } finally {
        if (!verifiedTransporter) {
          transporterPromise = null;
        }
      }
    })();
  }

  return transporterPromise;
}

export function getEmailErrorSummary(error: unknown): EmailErrorSummary {
  const normalizedError = normalizeEmailError(error);

  switch (normalizedError.code) {
    case "SMTP_NOT_CONFIGURED":
    case "SMTP_INVALID_CONFIG":
      return {
        code: normalizedError.code,
        message: "Serviço de recuperação por e-mail indisponível no momento. Avise a coordenação para redefinir sua senha.",
        statusCode: 503,
        retryable: false,
        diagnostic: "Configuração SMTP ausente ou inválida.",
      };
    case "SMTP_AUTH_ERROR":
      return {
        code: normalizedError.code,
        message: "Serviço de e-mail indisponível no momento. Avise a coordenação para redefinir sua senha.",
        statusCode: 503,
        retryable: false,
        diagnostic: "Falha de autenticação SMTP.",
      };
    case "SMTP_DNS_ERROR":
    case "SMTP_CONNECTION_ERROR":
    case "SMTP_TIMEOUT":
    case "SMTP_TLS_ERROR":
    case "SMTP_SEND_ERROR":
      return {
        code: normalizedError.code,
        message: "Não foi possível enviar o e-mail agora. Tente novamente em alguns minutos.",
        statusCode: 502,
        retryable: true,
        diagnostic: "Falha transitória ao conectar ou entregar pelo SMTP.",
      };
  }
}

export async function sendPasswordResetEmail(to: string, name: string, token: string) {
  const transporter = await getVerifiedTransporter();
  const config = getSmtpConfig();
  const resetUrl = `${getResetBaseUrl()}/taximetro/redefinir-senha/${token}`;

  try {
    await transporter.sendMail({
      from: config.from,
      to,
      subject: "Taxímetro Digital — Redefinição de Senha",
      html: `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="font-size: 20px; color: #1E3A5F; margin: 0;">Taxímetro Digital</h1>
      <p style="font-size: 13px; color: #64748b; margin: 4px 0 0;">SAMU 192 Salvador</p>
    </div>
    <p style="font-size: 15px; color: #334155;">Olá, <strong>${name}</strong>.</p>
    <p style="font-size: 15px; color: #334155;">Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo para criar uma nova senha:</p>
    <div style="text-align: center; margin: 28px 0;">
      <a href="${resetUrl}" style="display: inline-block; background-color: #1E3A5F; color: #fff; font-size: 15px; font-weight: 600; padding: 12px 32px; border-radius: 8px; text-decoration: none;">
      Redefinir Senha
      </a>
    </div>
    <p style="font-size: 13px; color: #94a3b8;">Este link expira em <strong>1 hora</strong>. Se você não solicitou esta redefinição, ignore este e-mail.</p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
    <p style="font-size: 12px; color: #94a3b8; text-align: center;">Se o botão não funcionar, copie e cole este link no navegador:<br/><a href="${resetUrl}" style="color: #64748b; word-break: break-all;">${resetUrl}</a></p>
    </div>
  `,
    });
  } catch (error) {
    const normalizedError = normalizeEmailError(error, {
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTls: config.requireTls,
      user: maskEmail(config.user),
      to: maskEmail(to),
    });
    logEmailEvent("send", config, normalizedError);
    throw normalizedError;
  }
}
