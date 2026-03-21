import { NextRequest, NextResponse } from "next/server";
import { getAvailableSlots } from "@/lib/slots";
import { getEffectiveUser } from "@/lib/impersonate";

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const facultyId = (user.role === "LEADER" || user.role === "INTERN")
    ? (user.facultyId ?? undefined)
    : searchParams.get("facultyId") ?? undefined;

  const slots = await getAvailableSlots(facultyId);
  return NextResponse.json({ success: true, data: slots });
}
