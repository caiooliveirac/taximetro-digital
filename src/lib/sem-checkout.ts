/**
 * "O preceptor saiu sem fazer meu checkout" (decisão do Caio, 18/11/2026).
 * O interno conta à Dai, sempre com o nome do médico, e a falta dele fica
 * justificada com um texto padrão. Não vira presença: o admin e o líder da
 * faculdade veem a justificativa nas faltas, e a coordenação decide se abona.
 * Substitui o checkout retroativo que o Caio fazia como preceptor.
 *
 * Puro, para teste: a rota (/api/intern/sem-checkout) e a Dai usam o mesmo.
 */

import { hasShiftStarted } from "@/lib/utils";
import { isAutoAbsenceAfterCheckin } from "@/shared/domain/policies/pending-attendance";

export const PREFIXO_SEM_CHECKOUT = "Preceptor ";

type Linha = {
  status: string;
  isExtraShift: boolean;
  checkinStatus: string | null;
  totpValidatedAt: Date | string | null;
  checkoutAt: Date | string | null;
  checkoutNotes: string | null;
  date: string;
  period: string;
  shift?: string | null;
};

/**
 * Dá para registrar: check-in validado e ninguém fechou — no turno que já
 * começou (ainda em CHECKED_IN) ou já virado falta automática pelo sweep.
 * Extra não fecha checkout (pending-attendance.ts), então nunca entra.
 */
export function semCheckoutRegistravel(l: Linha, now: Date = new Date()): boolean {
  if (l.isExtraShift || l.checkoutAt) return false;
  if (isAutoAbsenceAfterCheckin(l)) return true;
  return l.status === "CHECKED_IN"
    && l.totpValidatedAt != null
    && hasShiftStarted(String(l.date).slice(0, 10), l.period === "NIGHT" ? "NIGHT" : "DAY", l.shift, now);
}

const TITULO = /^(?:dr\.?|dra\.?|doutor[a]?|preceptor[a]?|m[eé]dic[oa])\s+/i;

/** Nome como o interno escreveu, sem "Dr." na frente; null se não parece nome. */
export function nomeDoPreceptor(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const nome = raw.replace(/\s+/g, " ").trim().replace(TITULO, "").trim();
  if (nome.length < 3 || nome.length > 80) return null;
  if (!/^[\p{L}][\p{L} .'-]*$/u.test(nome)) return null;
  return nome;
}

// Palavras que vêm depois de "o preceptor"/"o médico" e não são nome.
const NAO_E_NOME = new Set(["saiu", "foi", "nao", "não", "que", "sem", "ja", "já", "esqueceu", "deixou", "me", "do", "da", "de", "e", "é"]);

/**
 * "O Dr. João Silva saiu sem fazer meu checkout" → "João Silva". Só nome com
 * inicial maiúscula depois de Dr./Dra./doutor/preceptor/médico; o resto (nome
 * em minúscula, resposta só com o nome) fica com o modelo.
 */
export function nomeNaFrase(texto: string): string | null {
  const m = texto.match(/(?:^|[^\p{L}])(?:[Dd]ra?\.?|[Dd]outora?|[Pp]receptora?|[Mm][eé]dic[oa])\s+((?:[A-ZÀ-Ý][\p{L}'-]+)(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ý][\p{L}'-]+){0,3})/u);
  if (!m) return null;
  const palavras = m[1].split(/\s+/);
  if (NAO_E_NOME.has(palavras[0].toLowerCase())) return null;
  return nomeDoPreceptor(m[1]);
}

/** O texto que fica na falta. Hora em Salvador. */
export function textoSemCheckout(nome: string, now: Date = new Date()): string {
  const quando = now.toLocaleString("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `${PREFIXO_SEM_CHECKOUT}${nome} saiu sem realizar o checkout. Informado pelo interno à Dai em ${quando}.`;
}
