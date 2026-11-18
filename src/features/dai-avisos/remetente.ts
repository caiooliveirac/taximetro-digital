/**
 * A Dai no chat é um usuário sem login: `is_active = false` e hash de senha
 * que não é bcrypt (nenhuma senha confere). Ela só escreve — por jobs com
 * texto pronto (avisos.ts, sorteio-repescagem.ts) — e não recebe: a conversa
 * com ela é na aba Dai.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, internMessages, users } from "@/db/schema";

export type Envio = { para: string; texto: string; action: string; entityId: string; payload: Record<string, unknown> };

export const DAI_EMAIL = "dai@assistente.taximetro";
export const DAI_NOME = "Dai";

let cache: string | null = null;

/** Id da Dai; `criar` só nos jobs, que são quem precisa dela existindo. */
export async function idDaDai(opts: { criar?: boolean } = {}): Promise<string | null> {
  if (cache) return cache;
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, DAI_EMAIL)).limit(1);
  if (row) return (cache = row.id);
  if (!opts.criar) return null;
  const [novo] = await db
    .insert(users)
    .values({ name: DAI_NOME, email: DAI_EMAIL, passwordHash: "!sem-login", isActive: false })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
  if (novo) return (cache = novo.id);
  return idDaDai();
}

/**
 * Avisos em que o novo substitui o anterior ainda não lido do mesmo tipo, em vez
 * de empilhar. O interno lê tudo de uma vez quando abre a conversa (mediana de
 * 63h em nov/2026) e 88% dos avisos chegavam com outro do mesmo tipo não lido:
 * a pilha só escondia o que vale agora. Oferta de troca, troca a três,
 * solicitação e resultado de sorteio ficam de fora — cada um é um assunto
 * diferente, que o seguinte não cobre.
 */
const SUBSTITUI_NAO_LIDO = new Set([
  "DAI_AVISO_PLANTAO", "DAI_AVISO_VAGAS", "DAI_AVISO_REPESCAGEM", "DAI_AVISO_SORTEIO_ANUNCIO",
  "DAI_AVISO_SOBRA", "DAI_AVISO_REPOSICAO",
]);

/**
 * Para cada envio, a mensagem não lida que ele substitui (a mais recente do
 * mesmo tipo para a mesma pessoa), ou null para inserir. Puro.
 */
export function substituicoes(envios: Pick<Envio, "para" | "action">[], naoLidas: { id: string; para: string; action: string; em: Date }[]) {
  const ultima = new Map<string, { id: string; em: Date }>();
  for (const m of naoLidas) {
    if (!SUBSTITUI_NAO_LIDO.has(m.action)) continue;
    const k = `${m.para}|${m.action}`;
    const atual = ultima.get(k);
    if (!atual || m.em > atual.em) ultima.set(k, { id: m.id, em: m.em });
  }
  const usadas = new Set<string>();
  return envios.map((e) => {
    const m = SUBSTITUI_NAO_LIDO.has(e.action) ? ultima.get(`${e.para}|${e.action}`) : undefined;
    if (!m || usadas.has(m.id)) return null;
    usadas.add(m.id);
    return m.id;
  });
}

/**
 * Mensagem da Dai no chat + registro no audit_log (é o registro que impede
 * repetir). A mensagem e o registro nascem na mesma transação, com o mesmo
 * `now()`: é por esse horário que se sabe o tipo de cada mensagem.
 */
export async function enviar(envios: Envio[], dry: boolean) {
  if (dry || envios.length === 0) return;
  const dai = await idDaDai({ criar: true });
  if (!dai) throw new Error("Dai sem usuário");
  const acoes = [...new Set(envios.map((e) => e.action).filter((a) => SUBSTITUI_NAO_LIDO.has(a)))];
  const paras = [...new Set(envios.filter((e) => SUBSTITUI_NAO_LIDO.has(e.action)).map((e) => e.para))];
  await db.transaction(async (tx) => {
    const naoLidas = acoes.length
      ? await tx
          .select({ id: internMessages.id, para: internMessages.toUserId, action: auditLog.action, em: internMessages.createdAt })
          .from(internMessages)
          .innerJoin(auditLog, and(
            eq(auditLog.userId, dai),
            eq(auditLog.createdAt, internMessages.createdAt),
            inArray(auditLog.action, acoes),
            sql`${auditLog.payload}->>'para' = ${internMessages.toUserId}::text`,
          ))
          .where(and(eq(internMessages.fromUserId, dai), inArray(internMessages.toUserId, paras), isNull(internMessages.readAt)))
      : [];
    const trocar = substituicoes(envios, naoLidas);
    const novas = envios.filter((_, i) => !trocar[i]);
    for (const [i, id] of trocar.entries()) {
      if (id) await tx.update(internMessages).set({ body: envios[i].texto, createdAt: sql`now()` }).where(eq(internMessages.id, id));
    }
    if (novas.length) await tx.insert(internMessages).values(novas.map((e) => ({ fromUserId: dai, toUserId: e.para, body: e.texto })));
    await tx.insert(auditLog).values(envios.map((e) => ({ userId: dai, action: e.action, entity: "dai_aviso", entityId: e.entityId, payload: { para: e.para, ...e.payload } })));
  });
}
