import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { addDaysToDateStr, localDateStr } from "@/lib/utils";
import { listAssignmentsWithRelations } from "@/features/scheduling/infra/repositories/assignment-query-repository";
import { classifyPendingAttendance } from "@/shared/domain/policies/pending-attendance";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 31;

/**
 * Plantões de um intervalo de datas que ainda pedem ação do preceptor — sem
 * check-in ou sem checkout — em todas as bases e turnos. Serve a tela Validar
 * quando o preceptor volta a uma data para fechar o checkout esquecido.
 */
export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !["PRECEPTOR", "COORDINATOR"].includes(user.role)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const today = localDateStr();
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    return NextResponse.json({ success: false, error: "Datas inválidas" }, { status: 400 });
  }
  if (to > today) {
    return NextResponse.json({ success: false, error: "Data futura" }, { status: 400 });
  }
  if (addDaysToDateStr(to, -MAX_RANGE_DAYS) > from) {
    return NextResponse.json({ success: false, error: `Intervalo maior que ${MAX_RANGE_DAYS} dias` }, { status: 400 });
  }

  const rows = await listAssignmentsWithRelations({ dateFrom: from, dateTo: to, excludeCancelled: true });

  const data = rows.flatMap((r) => {
    if (r.internArchived) return [];
    const kind = classifyPendingAttendance({
      status: r.status,
      isExtraShift: r.isExtraShift,
      checkinStatus: r.checkinStatus,
      totpValidatedAt: r.totpValidatedAt,
      checkoutAt: r.checkoutAt,
      checkoutNotes: r.checkoutNotes,
    });
    if (!kind) return [];
    return [{
      id: r.id,
      internId: r.internId,
      internName: r.internName,
      facultyAbbr: r.facultyAbbr,
      baseCode: r.baseCode,
      baseName: r.baseName,
      date: r.date,
      period: r.period,
      shift: r.shift,
      status: r.status,
      checkinAt: r.checkinAt,
      kind,
    }];
  });

  return NextResponse.json({ success: true, data });
}
