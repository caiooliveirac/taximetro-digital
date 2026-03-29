import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  return NextResponse.json({
    success: false,
    error: "A criação avulsa pelo próprio interno foi desativada. Solicite a alocação ao líder ou à coordenação.",
  }, { status: 403 });
}
