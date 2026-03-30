import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

const ROLE_HOME: Record<string, string> = {
  COORDINATOR: "/admin",
  LEADER: "/leader",
  PRECEPTOR: "/preceptor",
  INTERN: "/intern",
};

export default async function RootPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.mustChangePassword) redirect("/trocar-senha");
  redirect(ROLE_HOME[session.user.role] ?? "/login");
}
