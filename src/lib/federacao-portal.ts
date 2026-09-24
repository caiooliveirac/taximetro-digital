/**
 * Entrada pelo portal mnrs.com.br (login único — kairos ADR 0013).
 *
 * O porteiro da raiz confere a senha no plantoes e, quando a pessoa toca no
 * card do Taxímetro, assina um token de 60 s no contrato de federação do
 * parque: JWT HS256, `tipo: "escala-handoff"`, `sub` = e-mail,
 * `aud` = "taximetro", chave MNRS_FEDERACAO_SECRET. Aqui só se confere o
 * token; QUEM entra continua decidido pela tabela `users` (ativo, com papel)
 * — ver o provedor "portal" em auth.ts.
 *
 * Só a instância SAMU tem a variável; sem ela (Vitalmed, dev), recusa sempre.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const ID_TAXIMETRO = "taximetro";
const TIPO = "escala-handoff";

export function lerTokenFederado(
  token: string,
  segredo: string | undefined = process.env.MNRS_FEDERACAO_SECRET,
  agora: number = Math.floor(Date.now() / 1000),
): string | null {
  if (!segredo || segredo.length < 32 || !token) return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  const [cabecalho, corpo, assinatura] = partes as [string, string, string];
  const esperada = createHmac("sha256", segredo).update(`${cabecalho}.${corpo}`).digest("base64url");
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const cab = JSON.parse(Buffer.from(cabecalho, "base64url").toString("utf8")) as { alg?: unknown };
    if (cab.alg !== "HS256") return null;
    const c = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as Record<string, unknown>;
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (c.tipo !== TIPO || !aud.includes(ID_TAXIMETRO)) return null;
    if (typeof c.exp !== "number" || c.exp <= agora) return null;
    if (typeof c.sub !== "string" || !c.sub.includes("@")) return null;
    return c.sub.trim().toLowerCase();
  } catch {
    return null;
  }
}
