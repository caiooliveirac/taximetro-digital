/**
 * Registro das perguntas feitas ao Dai (rota /api/intern/luna). Fica fora dos
 * arquivos da Luna porque eles têm de ser só leitura (tests/luna-interno.test.ts).
 */

import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import type { LunaResposta } from "@/lib/luna-interno";

// Pergunta e resposta ficam no audit_log para estudar o uso real; cada
// gravação apaga as do próprio interno mais velhas que RETENCAO_DIAS.
export const AUDIT_PERGUNTA = "DAI_PERGUNTA";
const RETENCAO_DIAS = 90;

/**
 * Perguntas de hoje que chamaram o modelo (rota "modelo" ou "modelo+ferramenta")
 * — as diretas do banco não gastam token e não contam. Vem do audit_log, não
 * da memória do processo, para não zerar a cada deploy. created_at grava hora
 * local (sessão America/Sao_Paulo), então comparar com a data local basta.
 */
export async function perguntasComModeloHoje(userId: string, hoje: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.action, AUDIT_PERGUNTA), gte(auditLog.createdAt, sql`${hoje}::date`), sql`${auditLog.payload}->>'rota' like 'modelo%'`));
  return r?.n ?? 0;
}

export async function gravarPergunta(userId: string, conversa: { content: string }[], r: LunaResposta, meta: Record<string, unknown>) {
  await logAudit({
    userId,
    action: AUDIT_PERGUNTA,
    entity: "dai",
    payload: {
      pergunta: conversa.at(-1)?.content,
      vez: Math.ceil(conversa.length / 2),
      resposta: r.texto.slice(0, 2000),
      cartoes: r.cartoes.map((c) => c.tipo),
      erro: r.erro ?? false,
      rota: meta.rota,
      intencao: meta.intencao,
      ferramentas: (meta.ferramentas as { nome: string; status: string }[] | undefined)?.map((f) => `${f.nome}:${f.status}`),
      args: meta.args,
      ms: meta.ms,
      // Tokens da chamada ao modelo (0 no caminho direto): o log do container some a cada deploy.
      entrada: meta.entrada ?? 0,
      saida: meta.saida ?? 0,
      cache: meta.cache ?? 0,
    },
  });
  await db
    .delete(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.action, AUDIT_PERGUNTA), lt(auditLog.createdAt, sql`now() - make_interval(days => ${RETENCAO_DIAS})`)));
}
