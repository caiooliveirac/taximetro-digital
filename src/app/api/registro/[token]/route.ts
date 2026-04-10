import { NextRequest, NextResponse } from "next/server";
import {
  executeGetInviteRegistrationInfo,
  executeRegisterWithInvite,
  registerWithInviteSchema,
} from "@/features/registration/application/use-cases/register-with-invite";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const result = await executeGetInviteRegistrationInfo(token);
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await req.json();
  const parsed = registerWithInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const result = await executeRegisterWithInvite({
    token,
    input: parsed.data,
  });

  return NextResponse.json(result.body, { status: result.status });
}
