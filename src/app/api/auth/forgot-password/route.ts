import { NextResponse } from "next/server";
import { executeRequestPasswordReset } from "@/features/auth/application/use-cases/request-password-reset";

function getRequestIp(req: Request) {
    return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || req.headers.get("x-real-ip")
        || null;
}

export async function POST(req: Request) {
    const body = await req.json();
    const result = await executeRequestPasswordReset({
        email: body?.email,
        ipAddress: getRequestIp(req),
    });

    return NextResponse.json(result.body, { status: result.status });
}
