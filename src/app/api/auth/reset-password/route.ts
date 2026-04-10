import { NextResponse } from "next/server";
import { executeResetPassword } from "@/features/auth/application/use-cases/reset-password";

export async function POST(req: Request) {
    const body = await req.json();
    const result = await executeResetPassword({
        token: body?.token,
        password: body?.password,
    });

    return NextResponse.json(result.body, { status: result.status });
}
