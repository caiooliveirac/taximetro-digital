import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
  createRequestSchema,
  executeCreateRequest,
  getRequestValidationError,
} from "@/features/requests/application/use-cases/create-request";
import {
  executeSwapPeerAction,
  swapPeerActionSchema,
} from "@/features/requests/application/use-cases/handle-swap-peer-action";
import { executeListRequests } from "@/features/requests/application/use-cases/list-requests";
import { executeReviewRequest } from "@/features/requests/application/use-cases/review-request";

/* ═══════════ GET — list requests ═══════════ */

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const filtered = await executeListRequests({
    actor: {
      id: user.id,
      role: user.role,
      facultyId: user.facultyId,
    },
    scope: searchParams.get("scope"),
    selfOnly: searchParams.get("selfOnly") === "true",
    internId: searchParams.get("internId"),
  });

  return NextResponse.json({ success: true, data: filtered });
}

/* ═══════════ POST — create request ═══════════ */

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const body = await req.json();
  const parsed = createRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: getRequestValidationError(parsed.error) }, { status: 400 });
  }

  const result = await executeCreateRequest({
    actor: {
      id: user.id,
      role: user.role,
      isImpersonating: user.isImpersonating,
      realUserId: user.realUserId,
    },
    input: parsed.data,
    onBehalfOf: typeof body.onBehalfOf === "string" ? body.onBehalfOf : undefined,
  });

  return NextResponse.json(result.body, { status: result.status });
}

/* ═══════════ PATCH — peer-to-peer swap actions ═══════════ */

export async function PATCH(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const body = await req.json();
  const parsed = swapPeerActionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });

  const result = await executeSwapPeerAction({
    actor: {
      id: user.id,
      realUserId: user.realUserId,
    },
    input: parsed.data,
  });

  return NextResponse.json(result.body, { status: result.status });
}

/* ═══════════ PUT — leader/coordinator review (DROP & EXTRA only) ═══════════ */

export async function PUT(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const result = await executeReviewRequest({
    actor: {
      id: user.id,
      role: user.role,
      facultyId: user.facultyId,
      isImpersonating: user.isImpersonating,
      realUserId: user.realUserId,
    },
    input: {
      id: body?.id,
      status: body?.status,
      reviewNotes: body?.reviewNotes,
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}
