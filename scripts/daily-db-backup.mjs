import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import nodemailer from "nodemailer";
import {
    generateAttendanceReports,
    htmlToPdf,
    resolveTelegramToken,
    sanitizeFilePart,
    sendTelegramDocument,
} from "./attendance-report-lib.mjs";

const DEFAULT_BACKUP_DIR = "/var/backups/taximetro";
const DEFAULT_BACKUP_PREFIX = "taximetro";
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_SMTP_FROM = "Taximetro Digital <noreply@mnrs.com.br>";

function parsePositiveInteger(value, fallback) {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
    if (value == null || value === "") return fallback;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
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

function sanitizeS3Prefix(value) {
    return (value ?? "")
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join("/");
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
    const allowedSuffixes = [".dump", ".dump.json", ".html", ".pdf"];

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

function getS3Config() {
    const bucket = process.env.DB_BACKUP_S3_BUCKET?.trim();
    const enabled = parseBoolean(process.env.DB_BACKUP_S3_ENABLED, Boolean(bucket));

    if (!enabled) {
        return null;
    }

    if (!bucket) {
        throw new Error("DB_BACKUP_S3_BUCKET precisa estar definido para enviar o backup ao S3.");
    }

    const region = process.env.DB_BACKUP_S3_REGION?.trim() || process.env.AWS_REGION?.trim() || "us-east-1";
    const endpoint = process.env.DB_BACKUP_S3_ENDPOINT?.trim() || undefined;
    const keyPrefix = sanitizeS3Prefix(process.env.DB_BACKUP_S3_PREFIX);
    const forcePathStyle = parseBoolean(process.env.DB_BACKUP_S3_FORCE_PATH_STYLE, false);

    return {
        bucket,
        region,
        endpoint,
        keyPrefix,
        forcePathStyle,
    };
}

function buildS3Key(prefix, filename) {
    return prefix ? `${prefix}/${filename}` : filename;
}

async function uploadFileToS3({ client, bucket, key, filePath, contentType, PutObjectCommandCtor }) {
    await client.send(new PutObjectCommandCtor({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: contentType,
    }));
}

async function uploadBackupToS3({ attachmentPath, metadataPath, s3Config, summary }) {
    const { PutObjectCommand, S3Client } = await import("@aws-sdk/client-s3");

    const client = new S3Client({
        region: s3Config.region,
        endpoint: s3Config.endpoint,
        forcePathStyle: s3Config.forcePathStyle,
    });

    const backupKey = buildS3Key(s3Config.keyPrefix, summary.filename);
    const metadataKey = `${backupKey}.json`;

    await uploadFileToS3({
        client,
        bucket: s3Config.bucket,
        key: backupKey,
        filePath: attachmentPath,
        contentType: "application/octet-stream",
        PutObjectCommandCtor: PutObjectCommand,
    });

    await uploadFileToS3({
        client,
        bucket: s3Config.bucket,
        key: metadataKey,
        filePath: metadataPath,
        contentType: "application/json",
        PutObjectCommandCtor: PutObjectCommand,
    });

    return {
        bucket: s3Config.bucket,
        region: s3Config.region,
        key: backupKey,
        metadataKey,
        endpoint: s3Config.endpoint ?? null,
    };
}

async function sendBackupEmail({ attachmentPath, metadataPath, recipients, smtpConfig, summary, reportAttachments }) {
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

    const subject = `[${summary.prefix}] Backup diario + Relatórios de Presenças`;
    const text = [
        `${summary.appName} - backup diario do banco + relatórios de presenças`,
        "",
        `Backup:`,
        `  Arquivo: ${summary.filename}`,
        `  Tamanho: ${summary.size}`,
        `  Banco: ${summary.database.database} @ ${summary.database.host}:${summary.database.port ?? "?"}`,
        `  Criado em: ${summary.finishedAt}`,
        `  Retencao local: ${summary.retentionDays} dia(s)`,
        "",
        `Relatórios de Presenças:`,
        `  ${reportAttachments.length} faculdade(s) incluída(s)`,
        "",
        "O dump segue em anexo no formato custom do pg_dump (.dump).",
        "Relatórios de presenças em HTML (um por faculdade, optimizado para impressão/PDF).",
        "Para restaurar backup: sh scripts/restore-db-backup.sh /caminho/do/arquivo.dump",
    ].join("\n");

    const attachments = [
        {
            filename: path.basename(attachmentPath),
            path: attachmentPath,
        },
        {
            filename: path.basename(metadataPath),
            path: metadataPath,
            contentType: "application/json",
        },
    ];

    // Add report attachments
    for (const report of reportAttachments) {
        attachments.push({
            filename: path.basename(report.htmlPath),
            path: report.htmlPath,
            contentType: "text/html; charset=utf-8",
            contentDisposition: "attachment",
        });
    }

    await transporter.sendMail({
        from: smtpConfig.from,
        to: recipients,
        subject,
        text,
        attachments,
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
    const s3Config = getS3Config();
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
        s3: s3Config
            ? {
                bucket: s3Config.bucket,
                region: s3Config.region,
                keyPrefix: s3Config.keyPrefix || null,
                endpoint: s3Config.endpoint ?? null,
            }
            : { status: "disabled" },
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
        s3: s3Config
            ? {
                bucket: s3Config.bucket,
                region: s3Config.region,
                keyPrefix: s3Config.keyPrefix || null,
                endpoint: s3Config.endpoint ?? null,
                status: "pending",
            }
            : {
                status: "disabled",
            },
        cleanup: {
            deletedFiles,
        },
    };

    await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

    const deliveryErrors = [];
    let reportAttachments = [];

    // Generate attendance reports
    try {
        reportAttachments = await generateAttendanceReports(databaseUrl);
        const reportTimestamp = filename.replace(/\.dump$/i, "");

        for (const report of reportAttachments) {
            const safeFaculty = sanitizeFilePart(report.facultyAbbr);
            const htmlPath = path.join(backupDir, `${reportTimestamp}-relatorio-${safeFaculty}.html`);

            await writeFile(htmlPath, report.html, "utf8");

            report.htmlPath = htmlPath;
        }

        if (reportAttachments.length > 0) {
            log("Relatórios de presenças gerados.", {
                faculties: reportAttachments.map((report) => report.facultyAbbr),
            });

            summary.reports = reportAttachments.map((report) => ({
                faculty: report.facultyAbbr,
                htmlPath: report.htmlPath,
            }));
            await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
        }
    } catch (error) {
        console.warn(`[db-backup] Warning: Failed to generate reports - ${error instanceof Error ? error.message : String(error)}`);
    }

    if (recipients.length > 0) {
        try {
            const smtpConfig = getSmtpConfig();
            await sendBackupEmail({
                attachmentPath: backupPath,
                metadataPath,
                recipients,
                smtpConfig,
                summary,
                reportAttachments,
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
            deliveryErrors.push(new Error(`envio por e-mail falhou: ${summary.email.error}`));
        }
    }

    if (s3Config) {
        try {
            const uploaded = await uploadBackupToS3({
                attachmentPath: backupPath,
                metadataPath,
                s3Config,
                summary,
            });
            summary.s3 = {
                ...summary.s3,
                ...uploaded,
                status: "uploaded",
            };
            await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
            log("Backup enviado ao S3.", {
                bucket: uploaded.bucket,
                key: uploaded.key,
                metadataKey: uploaded.metadataKey,
            });
        } catch (error) {
            summary.s3.status = "failed";
            summary.s3.error = error instanceof Error ? error.message : String(error);
            await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
            deliveryErrors.push(new Error(`upload S3 falhou: ${summary.s3.error}`));
        }
    }

    const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();
    const telegramToken = resolveTelegramToken();

    if (adminChatId && telegramToken) {
        summary.telegramAdmin = { status: "pending" };
        try {
            const reportTimestamp = filename.replace(/\.dump$/i, "");
            const sentDocuments = [];

            for (const report of reportAttachments) {
                const baseName = `${reportTimestamp}-relatorio-${sanitizeFilePart(report.facultyAbbr)}`;
                const pdf = await htmlToPdf(report.html);

                if (pdf) {
                    const pdfPath = path.join(backupDir, `${baseName}.pdf`);
                    await writeFile(pdfPath, pdf);
                    await sendTelegramDocument({
                        token: telegramToken,
                        chatId: adminChatId,
                        filename: `${baseName}.pdf`,
                        content: pdf,
                        contentType: "application/pdf",
                        caption: `📊 Relatório de presenças — ${report.facultyAbbr}`,
                    });
                    sentDocuments.push(`${baseName}.pdf`);
                } else {
                    await sendTelegramDocument({
                        token: telegramToken,
                        chatId: adminChatId,
                        filename: `${baseName}.html`,
                        content: Buffer.from(report.html, "utf8"),
                        contentType: "text/html",
                        caption: `📊 Relatório de presenças — ${report.facultyAbbr} (HTML — abra no navegador)`,
                    });
                    sentDocuments.push(`${baseName}.html`);
                }
            }

            const dumpContent = await readFile(backupPath);
            await sendTelegramDocument({
                token: telegramToken,
                chatId: adminChatId,
                filename,
                content: dumpContent,
                contentType: "application/octet-stream",
                caption: `🗄 Backup diário do banco — ${summary.size}`,
            });
            sentDocuments.push(filename);

            summary.telegramAdmin.status = "sent";
            summary.telegramAdmin.documents = sentDocuments;
            await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
            log("Backup e relatórios enviados ao Telegram do admin.", { documents: sentDocuments });
        } catch (error) {
            summary.telegramAdmin.status = "failed";
            summary.telegramAdmin.error = error instanceof Error ? error.message : String(error);
            await writeFile(metadataPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
            deliveryErrors.push(new Error(`envio Telegram admin falhou: ${summary.telegramAdmin.error}`));
        }
    }

    if (recipients.length === 0 && !s3Config) {
        log("Backup salvo localmente; envios remotos desabilitados.", {
            backupPath,
            metadataPath,
        });
    }

    if (deliveryErrors.length > 0) {
        throw new Error(deliveryErrors.map((error) => error.message).join(" | "));
    }

    log("Backup concluido com sucesso.", {
        filename,
        size: summary.size,
        deletedFiles,
    });
}

async function notifyTelegramFailure(errorMessage) {
    const token = process.env.TELEGRAM_BOT_TOKEN_NEXT || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    const chatIds = [process.env.TELEGRAM_GROUP_ID, process.env.TELEGRAM_ADMIN_CHAT_ID]
        .map((value) => value?.trim())
        .filter(Boolean);
    if (chatIds.length === 0) return;

    const text = `🚨 [taximetro] Backup diario falhou\n\n${errorMessage}`;
    for (const chatId of chatIds) {
        try {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text }),
            });
        } catch {
            // Falhar silenciosamente — nao queremos cron quebrando duas vezes
        }
    }
}

main().catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[db-backup] Falha no backup diario.", { error: message });
    await notifyTelegramFailure(message);
    process.exit(1);
});