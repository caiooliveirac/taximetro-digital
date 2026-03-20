import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { assignments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sseHeaders, sseEvent } from "@/lib/sse";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
  if (!token) return new Response("Unauthorized", { status: 401 });

  const { assignmentId } = await params;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let running = true;

      // Send initial status
      const [assignment] = await db.select().from(assignments).where(eq(assignments.id, assignmentId)).limit(1);
      if (assignment) {
        controller.enqueue(encoder.encode(sseEvent("status", { status: assignment.status })));
      }

      // Poll every 5 seconds
      const interval = setInterval(async () => {
        if (!running) return;
        try {
          const [a] = await db.select().from(assignments).where(eq(assignments.id, assignmentId)).limit(1);
          if (a) {
            controller.enqueue(encoder.encode(sseEvent("status", { status: a.status })));
            // Close stream when check-in is validated or terminal state
            if (["CHECKED_IN", "CHECKED_OUT", "ABSENT", "CANCELLED"].includes(a.status)) {
              running = false;
              clearInterval(interval);
              controller.close();
            }
          }
        } catch {
          running = false;
          clearInterval(interval);
          controller.close();
        }
      }, 5000);

      // Cleanup after 30 min max
      setTimeout(() => {
        running = false;
        clearInterval(interval);
        try { controller.close(); } catch { /* already closed */ }
      }, 30 * 60 * 1000);
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
