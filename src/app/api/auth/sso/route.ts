import type { NextRequest } from "next/server";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { lerTokenFederado } from "@/lib/federacao-portal";

/**
 * GET /taximetro/api/auth/sso?token=… — quem vem do portal mnrs.com.br já
 * logado. Token válido + usuário ativo com papel e o mesmo e-mail ⇒ mesma
 * sessão do login por senha (provedor "portal"). Qualquer outra coisa ⇒
 * /login com o motivo; e-mail/CPF e senha continuam funcionando como sempre.
 */
const voltar = (erro: string) =>
  new Response(null, { status: 307, headers: { location: `/taximetro/login?error=${erro}` } });

export async function GET(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!lerTokenFederado(token)) return voltar("PortalTokenInvalido");
  try {
    await signIn("portal", { token, redirectTo: "/taximetro" });
  } catch (erro) {
    if (erro instanceof AuthError) return voltar("PortalSemAcesso");
    throw erro; // o redirecionamento de sucesso do Auth.js
  }
  return voltar("PortalSemAcesso");
}
