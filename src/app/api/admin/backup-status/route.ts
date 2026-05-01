import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const BACKUP_DIR = process.env.DB_BACKUP_DIR || "/var/backups/taximetro";
const MAX_ENTRIES = 14;

type BackupEntry = {
  filename: string;
  finishedAt: string | null;
  sizeBytes: number | null;
  email: { status: string; error?: string | null } | null;
  s3: { status: string } | null;
  mtime: string;
};

export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || token.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  let entries: BackupEntry[] = [];
  let dirError: string | null = null;

  try {
    const files = await readdir(BACKUP_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".dump.json"));

    const stats = await Promise.all(
      jsonFiles.map(async (f) => {
        const fullPath = path.join(BACKUP_DIR, f);
        const s = await stat(fullPath);
        return { filename: f, fullPath, mtime: s.mtime };
      }),
    );

    stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    entries = await Promise.all(
      stats.slice(0, MAX_ENTRIES).map(async ({ filename, fullPath, mtime }) => {
        try {
          const raw = await readFile(fullPath, "utf8");
          const summary = JSON.parse(raw);
          return {
            filename,
            finishedAt: summary.finishedAt ?? null,
            sizeBytes: typeof summary.sizeBytes === "number" ? summary.sizeBytes : null,
            email: summary.email
              ? { status: summary.email.status ?? "unknown", error: summary.email.error ?? null }
              : null,
            s3: summary.s3 ? { status: summary.s3.status ?? "unknown" } : null,
            mtime: mtime.toISOString(),
          };
        } catch {
          return {
            filename,
            finishedAt: null,
            sizeBytes: null,
            email: null,
            s3: null,
            mtime: mtime.toISOString(),
          };
        }
      }),
    );
  } catch (error) {
    dirError = error instanceof Error ? error.message : String(error);
  }

  return NextResponse.json({
    success: true,
    backupDir: BACKUP_DIR,
    dirError,
    entries,
  });
}
