/**
 * A Dai no chat é um usuário sem login: `is_active = false` e hash de senha
 * que não é bcrypt (nenhuma senha confere). Ela só escreve — por jobs com
 * texto pronto (avisos.ts) — e não recebe: a conversa com ela é na aba Dai.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

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
