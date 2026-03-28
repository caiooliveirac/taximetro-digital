import { spawn } from "node:child_process";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import nodemailer from "nodemailer";

const DEFAULT_BACKUP_DIR = "/var/backups/taximetro";
const DEFAULT_BACKUP_PREFIX = "taximetro";
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_SMTP_FROM = "Taximetro Digital <noreply@mnrs.com.br>";

function parsePositiveInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCsv(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizePrefix(value) {
  const sanitized = (value ?? DEFAULT_BACKUP_PREFIX).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-");
  return sanitized.replace(/^-|-$/g, "") || DEFAULT_BACKUP_PREFIX;
}

function maskValue(value) {
  if (!value) return null;
  if (value.length <= 4) return "***";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function maskEmail(email) {
  const [local, domain] = email.split("@");
  if (!domain) return maskValue(email);
  const safeLocal = local.length <= 2 ? "***" : `${local.slice(0, 2)}***`;
  return `${safeLocal}@${domain}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function localTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("") + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function parseDatabaseInfo(connectionString) {
  try {
    const parsed = new URL(connectionString);
    return {
      host: parsed.hostname,
      port: Number.parseInt(parsed.port || "5432", 10),
      database: parsed.pathname.replace(/^\//, "") || "postgres",
      user: parsed.username ? maskValue(decodeURIComponent(parsed.username)) : null,
    };
  } catch {
    return {
      host: "unknown",
      port: null,
      database: "unknown",
      user: null,
    };
  }
}

function log(message, details = undefined) {
  if (details) {
    console.info(`[db-backup] ${message}`, details);
    return;
  }

  console.info(`[db-backup] ${message}`);
}

async function runPgDump({ databaseUrl, backupPath }) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        `--file=${backupPath}`,
        `--dbname=${databaseUrl}`,
      ],
      {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stderr = "";

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `pg_dump terminou com codigo ${code}`));
    });
  });
}

async function cleanupOldBackups({ backupDir, prefix, retentionDays }) {
  const deletedFiles = [];
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const allowedSuffixes = [".dump", ".dump.json"];

  for (const entry of await readdir(backupDir)) {
    if (!entry.startsWith(`${prefix}-`)) continue;
    if (!allowedSuffixes.some((suffix) => entry.endsWith(suffix))) continue;

    const fullPath = path.join(backupDir, entry);
    const info = await stat(fullPath);

    if (info.mtimeMs >= cutoff) continue;

    await unlink(fullPath);
    deletedFiles.push(entry);
  }

  return deletedFiles.sort((left, right) => left.localeCompare(right));
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM?.trim() || DEFAULT_SMTP_FROM;

  if (!host || !portRaw || !user || !pass) {
    throw new Error("SMTP_HOST, SMTP_PORT, SMTP_USER e SMTP_PASS precisam estar definidos para enviar o backup por e-mail.");
  }

  const port = Number.parseInt(portRaw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("SMTP_PORT invalido para envio do backup por e-mail.");
  }

  return {
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    requireTls: process.env.SMTP_REQUIRE_TLS === "true",
    rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
    user,
    pass,
    from,
  };
}

async function sendBackupEmail({ attachmentPath, metadataPath, recipients, smtpConfig, summary }) {
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    requireTLS: smtpConfig.requireTls,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.pass,
    },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    tls: {
      rejectUnauthorized: smtpConfig.rejectUnauthorized,
    },
  });

  await transporter.verify();

  const subject = `[${summary.prefix}] Backup diario do banco ${summary.filename}`;
  const text = [
    `${summary.appName} - backup diario do banco`,
    "",
    `Arquivo: ${summary.filename}`,
    `Tamanho: ${summary.size}`,
    `Banco: ${summary.database.database} @ ${summary.database.host}:${summary.database.port ?? "?"}`,
    `Criado em: ${summary.finishedAt}`,
    `Retencao local: ${summary.retentionDays} dia(s)`,
    "",
    "O dump segue em anexo no formato custom do pg_dump (.dump).",
    "Para restaurar: sh scripts/restore-db-backup.sh /caminho/do/arquivo.dump",
  ].join("\n");

  await transporter.sendMail({
    from: smtpConfig.from,
    to: recipients,
    subject,
    text,
    attachments: [
      {
        filename: path.basename(attachmentPath),
        path: attachmentPath,
      },
      {
        filename: path.basename(metadataPath),
        path: metadataPath,
        contentType: "application/json",
      },
    ],
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL nao configurada.");
  }

  const backupDir = process.env.DB_BACKUP_DIR?.trim() || DEFAULT_BACKUP_DIR;
  const prefix = sanitizePrefix(process.env.DB_BACKUP_PREFIX);
  const retentionDays = parsePositiveInteger(process.env.DB_BACKUP_RETENTION_DAYS, DEFAULT_RETENTION_DAYS);
  const recipients = parseCsv(process.env.DB_BACKUP_EMAIL_TO);
  const appName = process.env.DB_BACKUP_APP_NAME?.trim() || "Taximetro Digital";
  const timezone = process.env.TZ ?? process.env.DB_BACKUP_TZ ?? "UTC";
  const startedAt = new Date();
  const filename = `${prefix}-${localTimestamp(startedAt)}.dump`;
  const backupPath = path.join(backupDir, filename);
  const metadataPath = `${backupPath}.json`;
  const database = parseDatabaseInfo(databaseUrl);

  await mkdir(backupDir, { recursive: true });

  log("Iniciando backup diario.", {
    backupDir,
    prefix,
    retentionDays,
    timezone,
    database,
    emailRecipients: recipients.map((recipient) => maskEmail(recipient)),
  });

  await runPgDump({ databaseUrl, backupPath });

  const info = await stat(backupPath);
  const finishedAt = new Date();
  const deletedFiles = await cleanupOldBackups({ backupDir, prefix, retentionDays });

  const summary = {
    appName,
    prefix,
    filename,
    backupPath,
    metadataPath,
    sizeBytes: info.size,
    size: formatBytes(info.size),
    createdAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    retentionDays,
    timezone,
    database,
    email: recipients.length > 0
      ? {
          recipients: recipients.map((recipient) => maskEmail(recipient)),
          status: "pending",
        }
      : {
          recipients: [],
          status: "disabled",
        },
    cleanup: {
      deletedFiles,
    },
  };

  await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (recipients.length > 0) {
    try {
      const smtpConfig = getSmtpConfig();
      await sendBackupEmail({
        attachmentPath: backupPath,
        metadataPath,
        recipients,
        smtpConfig,
        summary,
      });
      summary.email.status = "sent";
      await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
      log("Backup enviado por e-mail.", {
        recipients: summary.email.recipients,
        filename,
      });
    } catch (error) {
      summary.email.status = "failed";
      summary.email.error = error instanceof Error ? error.message : String(error);
      await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
      throw error;
    }
  } else {
    log("Backup salvo localmente; envio por e-mail desabilitado.", {
      backupPath,
      metadataPath,
    });
  }

  log("Backup concluido com sucesso.", {
    filename,
    size: summary.size,
    deletedFiles,
  });
}

main().catch((error) => {
  console.error("[db-backup] Falha no backup diario.", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});