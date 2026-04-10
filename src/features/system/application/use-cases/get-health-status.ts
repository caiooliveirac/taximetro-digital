import { pingDatabase } from "@/features/system/infra/repositories/health-repository";

export async function executeGetHealthStatus() {
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
