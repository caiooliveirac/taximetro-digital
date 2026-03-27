import { NextRequest, NextResponse } from "next/server";
import { getAvailableSlots, getRequestableSlots } from "@/lib/slots";
import { getEffectiveUser } from "@/lib/impersonate";

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const selfOnly = searchParams.get("selfOnly") === "true";
  const weekStartParam = searchParams.get("weekStart");
  const weekStart = weekStartParam && /^\d{4}-\d{2}-\d{2}$/.test(weekStartParam)
    ? weekStartParam
    : undefined;
  const facultyId = (user.role === "LEADER" || user.role === "INTERN")
    ? (user.facultyId ?? undefined)
    : searchParams.get("facultyId") ?? undefined;

  if ((user.role === "INTERN" || user.role === "LEADER") && selfOnly) {
    if (!user.facultyId) {
      return NextResponse.json({ success: true, data: [] });
    }

    const slots = await getRequestableSlots(user.facultyId, user.id);
    return NextResponse.json({ success: true, data: slots });
  }

  if (user.role === "INTERN") {
    if (!user.facultyId) {
      return NextResponse.json({ success: true, data: [] });
    }

    const slots = await getRequestableSlots(user.facultyId, user.id);
    return NextResponse.json({ success: true, data: slots });
  }

  const slots = await getAvailableSlots(facultyId, weekStart);
  return NextResponse.json({ success: true, data: slots });
}
