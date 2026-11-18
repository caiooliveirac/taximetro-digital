/**
 * Remanejamento pelo próprio interno, no plantão em andamento.
 *
 * GET  ?assignmentId=  — só onde há vaga livre agora: as USAs com célula que
 *                        ele pode ocupar, quantas, e a base irmã (mesmo
 *                        endereço) como sugestão. Quem está em cada base (com
 *                        ou sem check-in, de qual faculdade) e o médico
 *                        presente não saem daqui: são da coordenação, no
 *                        Plantão ao vivo (ver `vagasLivresDoInterno`).
 * POST {assignmentId, newBaseId} — ocupa uma célula livre na hora e avisa a
 *                        coordenação.
 *
 * Só depois de um aviso (sem médico / sem enfermeiro / viatura) neste mesmo
 * plantão: o aviso é o gatilho, e é o que impede virar "mudo para a base perto
 * de casa". Pode repetir no mesmo plantão — ele pode ter se enganado de base.
 * Vale antes ou depois do check-in: o caso real é o interno que já chegou e
 * encontrou a base parada.
 *
 * Base com aviso de problema neste turno, parada pela coordenação no Plantão
 * ao vivo, ou desativada pelo chefe de plantão no `plantoes`, não oferece
 * célula livre: o aviso do interno já fecha a base dele para os outros. Aviso
 * cancelado pela coordenação ("falso alarme") deixa de valer também para o
 * interno que o deu: a grade dele fecha até ele avisar de novo.
 *
 * Tolerâncias, contadas do início real do turno (07:00 / 19:00): a grade só
 * abre aos 10 min, para quem ainda vai chegar fazer check-in e travar a própria
 * vaga; aos 15 min, escalado sem check-in continua visível mas a vaga dele
 * pode ser ocupada por quem procura, e a vaga além da grade (base com uma
 * vaga só por estratégia, mas que cabe dois) abre para todos.
 *
 * A vaga além da grade tem dono preferencial: o interno da base irmã (mesmo
 * endereço, outra viatura). Até os 15 min ela é reserva dele; depois, continua
 * reserva se ele avisou problema neste turno — senão fica livre para quem vier.
 *
 * A vaga é ocupada dentro de um advisory lock por (base, data, turno): dois
 * internos correndo para a mesma vaga entram um de cada vez, e o segundo já
 * não a encontra. O remanejamento em si é o mesmo caso de uso do admin/líder,
 * que grava a nota [REMANEJADO] e o audit.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { getEffectiveUser } from "@/lib/impersonate";
import { formatBrazilTime } from "@/lib/utils";
import { avisarSecretario } from "@/lib/aviso-tom";
import { celulaOcupavel, motivoDoRemanejamento, textoDoRemanejamento } from "@/lib/remanejamento-interno";
import { SEM_AVISO, gradeDoTurno, plantaoEmAndamento, toleranciaAgora, ultimoAviso, vagasAgora } from "@/lib/remanejamento-grade";
import { executeReassignAssignmentBase } from "@/features/scheduling/application/use-cases/reassign-assignment-base";

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "INTERN") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const assignmentId = req.nextUrl.searchParams.get("assignmentId") ?? "";
  if (!z.string().uuid().safeParse(assignmentId).success) {
    return NextResponse.json({ success: false, error: "Pedido inválido" }, { status: 400 });
  }

  const plantao = await plantaoEmAndamento(user.id, assignmentId);
  if ("error" in plantao) return NextResponse.json({ success: false, error: plantao.error }, { status: plantao.status });
  if ((await ultimoAviso(plantao)) === null) {
    return NextResponse.json({ success: false, error: SEM_AVISO }, { status: 409 });
  }
  return NextResponse.json({ success: true, data: await vagasAgora(plantao) });
}

const postSchema = z.object({
  assignmentId: z.string().uuid(),
  newBaseId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "INTERN") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Pedido inválido" }, { status: 400 });
  }
  const { assignmentId, newBaseId } = parsed.data;

  const plantao = await plantaoEmAndamento(user.id, assignmentId);
  if ("error" in plantao) return NextResponse.json({ success: false, error: plantao.error }, { status: plantao.status });
  const tipo = await ultimoAviso(plantao);
  if (tipo === null) return NextResponse.json({ success: false, error: SEM_AVISO }, { status: 409 });
  const motivo = motivoDoRemanejamento(tipo);

  const { aberta, abreAs, reivindicando } = toleranciaAgora(plantao.period);
  if (!aberta) {
    return NextResponse.json({ success: false, error: `A grade de vagas abre às ${abreAs}.` }, { status: 409 });
  }

  // O lock vive nesta transação; o caso de uso escreve pela conexão do pool,
  // mas só depois de o lock ser nosso, e o update dele já está commitado quando
  // o lock solta. Quem vier depois lê a célula já ocupada.
  const chave = `remanejamento:${newBaseId}:${plantao.date}:${plantao.period}`;
  const resultado = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${chave}))`);

    const destino = (await gradeDoTurno(plantao, reivindicando)).bases.find((b) => b.id === newBaseId);
    if (!destino) return { status: 404, body: { success: false, error: "Base de destino inválida" } } as const;
    // Desativada, parada ou com aviso já não oferece célula (bloqueada em
    // gradeDoTurno). A resposta não diz qual dos três: isso é da coordenação.
    if (!destino.celulas.some(celulaOcupavel)) {
      return { status: 409, body: { success: false, error: `A ${destino.code} já não tem vaga neste turno.` } } as const;
    }

    const remanejado = await executeReassignAssignmentBase({
      actor: {
        id: user.id,
        role: user.role,
        facultyId: user.facultyId,
        isImpersonating: user.isImpersonating,
        realUserId: user.realUserId,
      },
      input: {
        assignmentId: plantao.id,
        newBaseId: destino.id,
        reason: `Remanejamento pelo interno: ${motivo}`,
        authorized: true,
        apenasComCheckin: reivindicando,
      },
    });
    return { ...remanejado, baseCode: destino.code };
  });

  if (resultado.status !== 200) return NextResponse.json(resultado.body, { status: resultado.status });

  const entregue = await avisarSecretario(
    textoDoRemanejamento({
      interno: plantao.interno,
      faculdade: plantao.faculdade,
      de: plantao.baseCode,
      para: resultado.baseCode,
      hora: formatBrazilTime(new Date()),
      motivo,
    }),
  );

  return NextResponse.json({ success: true, data: { baseCode: resultado.baseCode, entregue } });
}
