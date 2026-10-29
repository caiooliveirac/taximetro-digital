/**
 * /api/intern/mensagens — conversa direta entre internos, para combinar troca
 * de plantão ou pedir ao líder uma vaga liberada.
 *
 * GET              → lista de conversas (uma por pessoa) e total não lido
 * GET ?com=<id>    → a conversa com essa pessoa; marca como lidas as recebidas
 * POST             → { para, texto, requestId? } envia uma mensagem
 *
 * Só conversa quem tem vínculo ativo de interno ou líder, de qualquer
 * faculdade. Coordenador personificando lê, mas não escreve em nome do interno.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { faculties, internMessages, requests, userRoles, users } from "@/db/schema";
import { getEffectiveUser } from "@/lib/impersonate";
import { checkRateLimit } from "@/shared/infra/rate-limit";

const PAPEIS = ["INTERN", "LEADER"] as const;

const envio = z.object({
  para: z.string().uuid(),
  texto: z.string().trim().min(1).max(1000),
  requestId: z.string().uuid().optional(),
});

async function quem(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || !PAPEIS.includes(user.role as (typeof PAPEIS)[number])) return null;
  return user;
}

/** Nome e faculdade de quem pode conversar (vínculo ativo de interno ou líder). */
async function pessoas(ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; nome: string; faculdade: string | null }>();
  const rows = await db
    .select({ id: users.id, nome: users.name, faculdade: faculties.abbreviation, role: userRoles.role })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(faculties, eq(faculties.id, userRoles.facultyId))
    .where(and(
      inArray(users.id, ids),
      eq(users.isActive, true),
      eq(userRoles.isActive, true),
      eq(userRoles.isArchived, false),
      inArray(userRoles.role, [...PAPEIS]),
    ));
  const mapa = new Map<string, { id: string; nome: string; faculdade: string | null }>();
  // Interno ganha do líder na hora de dizer a faculdade: é a dele de origem.
  const peso = (role: string) => (role === "INTERN" ? 0 : 1);
  for (const r of [...rows].sort((a, b) => peso(a.role) - peso(b.role))) {
    if (!mapa.has(r.id)) mapa.set(r.id, { id: r.id, nome: r.nome, faculdade: r.faculdade });
  }
  return mapa;
}

export async function GET(req: NextRequest) {
  const user = await quem(req);
  if (!user) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const com = req.nextUrl.searchParams.get("com");
  if (com) {
    if (!z.string().uuid().safeParse(com).success) {
      return NextResponse.json({ success: false, error: "Pessoa inválida" }, { status: 400 });
    }
    const pessoa = (await pessoas([com])).get(com);
    if (!pessoa) return NextResponse.json({ success: false, error: "Pessoa não encontrada" }, { status: 404 });

    const mensagens = await db
      .select({
        id: internMessages.id,
        de: internMessages.fromUserId,
        texto: internMessages.body,
        requestId: internMessages.requestId,
        em: internMessages.createdAt,
        lidaEm: internMessages.readAt,
      })
      .from(internMessages)
      .where(or(
        and(eq(internMessages.fromUserId, user.id), eq(internMessages.toUserId, com)),
        and(eq(internMessages.fromUserId, com), eq(internMessages.toUserId, user.id)),
      ))
      .orderBy(desc(internMessages.createdAt))
      .limit(200);

    if (!user.isImpersonating) {
      await db
        .update(internMessages)
        .set({ readAt: new Date() })
        .where(and(eq(internMessages.fromUserId, com), eq(internMessages.toUserId, user.id), isNull(internMessages.readAt)));
    }

    return NextResponse.json({
      success: true,
      data: {
        eu: user.id,
        pessoa,
        mensagens: mensagens.reverse().map((m) => ({ ...m, minha: m.de === user.id })),
      },
    });
  }

  const recentes = await db
    .select({
      de: internMessages.fromUserId,
      para: internMessages.toUserId,
      texto: internMessages.body,
      em: internMessages.createdAt,
      lidaEm: internMessages.readAt,
    })
    .from(internMessages)
    .where(or(eq(internMessages.fromUserId, user.id), eq(internMessages.toUserId, user.id)))
    .orderBy(desc(internMessages.createdAt))
    .limit(500);

  const porPessoa = new Map<string, { comId: string; ultima: { texto: string; em: Date; minha: boolean }; naoLidas: number }>();
  for (const m of recentes) {
    const comId = m.de === user.id ? m.para : m.de;
    const conversa = porPessoa.get(comId) ?? { comId, ultima: { texto: m.texto, em: m.em, minha: m.de === user.id }, naoLidas: 0 };
    if (m.para === user.id && !m.lidaEm) conversa.naoLidas++;
    porPessoa.set(comId, conversa);
  }
  const nomes = await pessoas([...porPessoa.keys()]);
  const conversas = [...porPessoa.values()]
    .filter((c) => nomes.has(c.comId))
    .map((c) => ({ ...c, nome: nomes.get(c.comId)!.nome, faculdade: nomes.get(c.comId)!.faculdade }));

  return NextResponse.json({
    success: true,
    data: { conversas, naoLidas: conversas.reduce((n, c) => n + c.naoLidas, 0) },
  });
}

export async function POST(req: NextRequest) {
  const user = await quem(req);
  if (!user) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  if (user.isImpersonating) {
    return NextResponse.json({ success: false, error: "Personificando, você lê a conversa mas não escreve pelo interno." }, { status: 403 });
  }
  const parsed = envio.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Mensagem vazia ou longa demais (até 1000 letras)." }, { status: 400 });
  const { para, texto, requestId } = parsed.data;
  if (para === user.id) return NextResponse.json({ success: false, error: "Não dá para mandar mensagem para você mesmo." }, { status: 400 });
  if (!checkRateLimit(`mensagens:${user.id}`, 30, 5 * 60_000)) {
    return NextResponse.json({ success: false, error: "Muitas mensagens seguidas. Espere uns minutos." }, { status: 429 });
  }
  if (!(await pessoas([para])).has(para)) {
    return NextResponse.json({ success: false, error: "Essa pessoa não está ativa no sistema." }, { status: 404 });
  }

  // A oferta de troca é só contexto: se não existir mais, a mensagem vai sem ela.
  const [oferta] = requestId
    ? await db.select({ id: requests.id }).from(requests).where(eq(requests.id, requestId)).limit(1)
    : [];

  const [mensagem] = await db
    .insert(internMessages)
    .values({ fromUserId: user.id, toUserId: para, body: texto, requestId: oferta?.id ?? null })
    .returning({ id: internMessages.id, texto: internMessages.body, em: internMessages.createdAt });

  return NextResponse.json({ success: true, data: { ...mensagem, minha: true } }, { status: 201 });
}
