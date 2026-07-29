/**
 * feature-gate.ts — bloqueio de verdade, no servidor.
 *
 * Esconder o item do menu não é proteção: a rota continua respondendo para quem
 * digitar a URL. Estes dois helpers fecham a porta no servidor, e são o que o
 * teste de isolamento entre instâncias verifica.
 *
 * Responde 404 (e não 403) de propósito: numa instância que não tem a feature,
 * a rota simplesmente não existe — não há por que confirmar que ela existe em
 * algum outro lugar.
 */

import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { temFeature, temEscala, type Feature } from "./instance";

/** Para route handlers: `const bloqueio = bloqueioDeFeature("adminLottery"); if (bloqueio) return bloqueio;` */
export function bloqueioDeFeature(feature: Feature): NextResponse | null {
  if (temFeature(feature)) return null;
  return NextResponse.json({ success: false, error: "Não encontrado" }, { status: 404 });
}

/** Para páginas (server components): interrompe a renderização com 404. */
export function exigirFeature(feature: Feature): void {
  if (!temFeature(feature)) notFound();
}

/** Idem, para as escalas que não existem em todas as instâncias (ex.: CRL na Vitalmed). */
export function exigirEscala(slug: "usa" | "cru" | "crl"): void {
  if (!temEscala(slug)) notFound();
}
