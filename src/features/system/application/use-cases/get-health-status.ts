import { pingDatabase } from "@/features/system/infra/repositories/health-repository";
import { validateCriticalEnv } from "@/lib/env-check";

export async function executeGetHealthStatus() {
  const env = validateCriticalEnv();
  if (!env.ok) {
    return {
      statusCode: 503,
      body: {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        reason: "missing_env",
        missing: env.missing,
      },
    } as const;
  }

  try {
    const start = Date.now();
    await pingDatabase();
    const dbMs = Date.now() - start;

    return {
      statusCode: 200,
      body: {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        db: { connected: true, latencyMs: dbMs },
      },
    } as const;
  } catch {
    return {
      statusCode: 503,
      body: {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        db: { connected: false },
      },
    } as const;
  }
}
