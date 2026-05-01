const ALWAYS_REQUIRED = [
  "AUTH_SECRET",
  "DATABASE_URL",
  "AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

const REQUIRED_WHEN_BACKUP_ENABLED = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "DB_BACKUP_EMAIL_TO",
] as const;

export type EnvCheckResult = {
  ok: boolean;
  missing: string[];
};

export function validateCriticalEnv(): EnvCheckResult {
  const required: string[] = [...ALWAYS_REQUIRED];
  if (process.env.DB_BACKUP_ENABLED !== "false") {
    required.push(...REQUIRED_WHEN_BACKUP_ENABLED);
  }

  const missing = required.filter((name) => {
    const value = process.env[name];
    return !value || value.trim() === "";
  });

  return { ok: missing.length === 0, missing };
}
