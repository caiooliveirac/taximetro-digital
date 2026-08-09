/**
 * admin-escala.ts — o ator das rotas de montar escala do coordenador.
 *
 * As rotas de `/api/admin/escala/*` usam os mesmos casos de uso das rotas do
 * líder (`/api/leader/*`). A única diferença é de onde vem a faculdade: o líder
 * tem a dele no vínculo, o coordenador não é vinculado a nenhuma e precisa
 * dizer qual — daí o `facultyId` obrigatório na query ou no corpo.
 *
 * Este helper existe para que essa checagem seja idêntica nas quatro rotas. Se
 * ficasse copiada, uma delas acabaria aceitando faculdade faltando, ou papel
 * errado, e ninguém notaria até alguém montar escala na faculdade errada.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEffectiveUser } from "@/lib/impersonate";
import type { SchedulingActor } from "@/features/scheduling/application/use-cases/cru-fixed-shared";

const faculdadeSchema = z.string().uuid();

type Escopo =
  | { ok: true; actor: SchedulingActor & { facultyId: string } }
  | { ok: false; resposta: NextResponse };

/**
 * Coordenador + faculdade escolhida, ou a resposta de erro pronta.
 *
 * `facultyId` chega da query (GET/DELETE) ou do corpo (POST/PATCH) — quem chama
 * passa o valor que já tem em mão.
 *
 * A tela manda `x-no-impersonate: 1`, então `getEffectiveUser` devolve o
 * coordenador de verdade mesmo com impersonate ativo no navegador. Sem esse
 * cabeçalho a requisição chega como o líder visitado por último e cai no 403
 * daqui — o que é o certo: quem está agindo como líder usa a tela do líder.
 */
export async function escopoDoAdminNaEscala(
  req: NextRequest,
  facultyId: unknown,
): Promise<Escopo> {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "COORDINATOR") {
    return {
      ok: false,
      resposta: NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 }),
    };
  }

  const faculdade = faculdadeSchema.safeParse(facultyId);
  if (!faculdade.success) {
    return {
      ok: false,
      resposta: NextResponse.json({ success: false, error: "Selecione a faculdade" }, { status: 400 }),
    };
  }

  return {
    ok: true,
    actor: {
      id: user.id,
      role: user.role,
      facultyId: faculdade.data,
      isImpersonating: user.isImpersonating,
      realUserId: user.realUserId,
    },
  };
}
