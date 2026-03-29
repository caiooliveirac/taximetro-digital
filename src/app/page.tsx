import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

const ROLE_HOME: Record<string, string> = {
  COORDINATOR: "/taximetro/admin",
  LEADER: "/taximetro/leader",
  PRECEPTOR: "/taximetro/preceptor",
  INTERN: "/taximetro/intern",
};

export default async function RootPage() {
  const session = await auth();
  if (!session?.user) redirect("/taximetro/login");
  if (session.user.mustChangePassword) redirect("/taximetro/trocar-senha");
  redirect(ROLE_HOME[session.user.role] ?? "/taximetro/login");
}
