import { NextRequest, NextResponse } from "next/server";
import {
  directRegistrationSchema,
  executeDirectRegistration,
} from "@/features/registration/application/use-cases/register-direct";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = directRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const result = await executeDirectRegistration(parsed.data);
  return NextResponse.json(result.body, { status: result.status });
}
