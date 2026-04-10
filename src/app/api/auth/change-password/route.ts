import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { executeChangePassword } from "@/features/auth/application/use-cases/change-password";

export async function POST(req: Request) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ success: false, error: "Não autenticado." }, { status: 401 });
    }

    const body = await req.json();
    const result = await executeChangePassword({
        userId: session.user.id,
        currentPassword: body?.currentPassword,
        newPassword: body?.newPassword,
    });

    return NextResponse.json(result.body, { status: result.status });
}
