/**
 * A Dai no chat é um usuário sem login: `is_active = false` e hash de senha
 * que não é bcrypt (nenhuma senha confere). Ela só escreve — por jobs com
 * texto pronto (avisos.ts, sorteio-repescagem.ts) — e não recebe: a conversa
 * com ela é na aba Dai.
 */

import { eq } from "drizzle-orm";
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

/** Mensagem da Dai no chat + registro no audit_log (é o registro que impede repetir). */
export async function enviar(envios: Envio[], dry: boolean) {
  if (dry || envios.length === 0) return;
  const dai = await idDaDai({ criar: true });
  if (!dai) throw new Error("Dai sem usuário");
  await db.transaction(async (tx) => {
    await tx.insert(internMessages).values(envios.map((e) => ({ fromUserId: dai, toUserId: e.para, body: e.texto })));
    await tx.insert(auditLog).values(envios.map((e) => ({ userId: dai, action: e.action, entity: "dai_aviso", entityId: e.entityId, payload: { para: e.para, ...e.payload } })));
  });
}
