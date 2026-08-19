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
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token) return new Response("Unauthorized", { status: 401 });

  const { assignmentId } = await params;
  const after = req.nextUrl.searchParams.get("after");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let running = true;

      // Terminal states depend on what we're waiting for
      const isTerminal = (status: string) => {
        if (after === "CHECKED_IN") {
          // Checkout listener: skip CHECKED_IN, close on CHECKED_OUT or other terminal
          return ["CHECKED_OUT", "ABSENT", "CANCELLED", "EXCUSED"].includes(status);
        }
        return ["CHECKED_IN", "CHECKED_OUT", "ABSENT", "CANCELLED", "EXCUSED"].includes(status);
      };

      // Send initial status
      const [assignment] = await db.select().from(assignments).where(eq(assignments.id, assignmentId)).limit(1);
      if (assignment) {
        controller.enqueue(encoder.encode(sseEvent("status", { status: assignment.status })));
        if (isTerminal(assignment.status)) {
          controller.close();
          return;
        }
      }

      // Poll every 5 seconds
      const interval = setInterval(async () => {
        if (!running) return;
        try {
          const [a] = await db.select().from(assignments).where(eq(assignments.id, assignmentId)).limit(1);
          if (a) {
            controller.enqueue(encoder.encode(sseEvent("status", { status: a.status })));
            if (isTerminal(a.status)) {
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
