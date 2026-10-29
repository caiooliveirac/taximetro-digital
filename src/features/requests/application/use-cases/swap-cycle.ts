/**
 * Troca a três (roda): propor, confirmar, recusar, cancelar.
 *
 * A validação é sempre do resultado final (swap-cycle-policy.ts), feita de
 * novo a cada confirmação: entre a proposta e o último sim a escala de alguém
 * pode ter mudado. Quando os três confirmam, aplica tudo numa transação
 * (swap-cycle-repository.ts). A Dai avisa cada etapa no chat (feature
 * avisoDeRodas).
 */

import { temFeature } from "@/lib/instance";
import { quando } from "@/lib/luna-inteligencia";
import { hasShiftStarted } from "@/lib/utils";
import { logAudit } from "@/shared/infra/logger/audit";
import { montarRoda, problemaNaRoda, type PernaDaRoda } from "@/shared/domain/policies/swap-cycle-policy";
import type { PlantaoDoMercado } from "@/shared/domain/policies/swap-match-policy";
import { enviar, type Envio } from "@/features/dai-avisos/avisos";
import { textoRodaDesfeita, textoRodaFechada, textoRodaProposta, type PernaAvisada } from "@/features/dai-avisos/textos";
import { carregarMercado, type FotografiaDoMercado } from "./load-swap-market";
import { findInternOverCruQuota } from "./handle-swap-peer-action";
import {
  aplicarRoda,
  confirmarPerna,
  criarRoda,
  fecharRoda,
  rodaPorId,
  type RodaGravada,
} from "@/features/requests/infra/repositories/swap-cycle-repository";

type Ator = { id: string; realUserId: string | null };
type Resposta = { status: number; body: { success: boolean; error?: string; data?: unknown } };

const erro = (status: number, error: string): Resposta => ({ status, body: { success: false, error } });

export const AUDIT_RODA = {
  PROPOSTA: "PROPOSE_SWAP_CYCLE",
  CONFIRMADA: "CONFIRM_SWAP_CYCLE",
  CONCLUIDA: "COMPLETE_SWAP_CYCLE",
  FECHADA: "CLOSE_SWAP_CYCLE",
  AVISO: "DAI_AVISO_RODA_ETAPA",
} as const;

const curto = (p: PlantaoDoMercado) => `${p.baseName.replace(/^Base\s+/i, "")}, ${quando(p.date.slice(0, 10), p.period, p.shift)}`;
const primeiro = (foto: FotografiaDoMercado, id: string) => (foto.ctx.nomes.get(id) ?? "Um colega").trim().split(/\s+/)[0];

/** Cota de CRU dos três, se a roda for de CRU: é a única regra que pede consulta à parte. */
async function cotaDosTres(foto: FotografiaDoMercado, pernas: PernaDaRoda[]) {
  if (pernas[0]?.entrega.baseType !== "CENTRAL") return;
  for (const p of pernas) if (await findInternOverCruQuota([p.internId], foto.hoje)) foto.ctx.cotaCruUsada.add(p.internId);
}

/** Plantões que podem estar "em solicitação" e mesmo assim entrar: ofertas abertas sem proposta, e a própria roda. */
function liberadosPara(foto: FotografiaDoMercado, ids: string[], daPropriaRoda = false) {
  const abertas = new Set(foto.ofertas.map((o) => o.plantao.id));
  return new Set(ids.filter((id) => daPropriaRoda || abertas.has(id)));
}

function pernaAvisada(foto: FotografiaDoMercado, pernas: PernaDaRoda[], i: number): PernaAvisada {
  const p = pernas[i];
  const anterior = pernas[(i - 1 + pernas.length) % pernas.length];
  const proximo = pernas[(i + 1) % pernas.length];
  return {
    quem: primeiro(foto, p.internId),
    entrega: curto(p.entrega),
    recebe: curto(p.recebe),
    deQuem: primeiro(foto, anterior.internId),
    paraQuem: primeiro(foto, proximo.internId),
  };
}

async function avisar(envios: Envio[]) {
  if (!temFeature("avisoDeRodas") || envios.length === 0) return;
  // Aviso é cortesia: a roda já está gravada; falha de envio não desfaz nada.
  await enviar(envios, false).catch((e) => console.warn(`[roda] aviso falhou: ${e instanceof Error ? e.message : e}`));
}

function pernasDaGravada(foto: FotografiaDoMercado, roda: RodaGravada): PernaDaRoda[] | null {
  const porId = new Map(foto.ctx.plantoes.map((p) => [p.id, p]));
  const entregas = roda.pernas.map((p) => porId.get(p.givesAssignmentId));
  if (entregas.some((e) => !e)) return null;
  return montarRoda(entregas as PlantaoDoMercado[]);
}

/**
 * Propõe a roda: `assignmentIds` em ordem — cada um entrega para o seguinte, o
 * último para o primeiro. Com `qualquerSentido`, tenta também a ordem inversa
 * (montagem à mão, em que quem monta não sabe para que lado fecha).
 */
export async function proporRoda(params: { ator: Ator; assignmentIds: string[]; qualquerSentido?: boolean }): Promise<Resposta> {
  const { ator } = params;
  if (new Set(params.assignmentIds).size !== 3) return erro(400, "Escolha três plantões diferentes.");

  const foto = await carregarMercado(new Date());
  const porId = new Map(foto.ctx.plantoes.map((p) => [p.id, p]));
  const entregas = params.assignmentIds.map((id) => porId.get(id));
  if (entregas.some((e) => !e)) return erro(404, "Um dos plantões não foi encontrado ou já passou.");
  if (!entregas.some((e) => e!.internId === ator.id)) return erro(403, "Você precisa entregar um dos plantões da roda.");

  const sentidos = [entregas as PlantaoDoMercado[]];
  if (params.qualquerSentido) sentidos.push([entregas[0]!, entregas[2]!, entregas[1]!]);

  let escolhida: PernaDaRoda[] | null = null;
  let problema: string | null = null;
  for (const s of sentidos) {
    const pernas = montarRoda(s);
    await cotaDosTres(foto, pernas);
    problema = problemaNaRoda(pernas, foto.ctx, liberadosPara(foto, s.map((p) => p.id)));
    if (!problema) { escolhida = pernas; break; }
  }
  if (!escolhida) return erro(409, problema ?? "Essa roda não fecha.");

  const id = await criarRoda({
    proposedBy: ator.id,
    pernas: escolhida.map((p) => ({ internId: p.internId, givesAssignmentId: p.entrega.id, receivesAssignmentId: p.recebe.id })),
  });
  await logAudit({
    userId: ator.realUserId ?? ator.id,
    action: AUDIT_RODA.PROPOSTA,
    entity: "swap_cycle",
    entityId: id,
    payload: { pernas: escolhida.map((p) => ({ internId: p.internId, entrega: p.entrega.id, recebe: p.recebe.id })) },
  });

  const quemPropos = primeiro(foto, ator.id);
  await avisar(escolhida
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.internId !== ator.id)
    .map(({ p, i }) => ({
      para: p.internId,
      texto: textoRodaProposta(quemPropos, pernaAvisada(foto, escolhida!, i)),
      action: AUDIT_RODA.AVISO,
      entityId: p.internId,
      payload: { roda: id, etapa: "PROPOSTA" },
    })));

  return { status: 201, body: { success: true, data: { id } } };
}

async function desfazer(foto: FotografiaDoMercado, roda: RodaGravada, status: "RECUSADA" | "CANCELADA" | "EXPIRADA", motivo: string, ator: Ator) {
  await fecharRoda(roda.id, status, motivo);
  await logAudit({ userId: ator.realUserId ?? ator.id, action: AUDIT_RODA.FECHADA, entity: "swap_cycle", entityId: roda.id, payload: { status, motivo } });
  await avisar(roda.pernas
    .filter((p) => p.internId !== ator.id)
    .map((p) => ({ para: p.internId, texto: textoRodaDesfeita(motivo), action: AUDIT_RODA.AVISO, entityId: p.internId, payload: { roda: roda.id, etapa: status } })));
}

export async function responderRoda(params: { ator: Ator; id: string; acao: "confirmar" | "recusar" | "cancelar" }): Promise<Resposta> {
  const { ator, id, acao } = params;
  const roda = await rodaPorId(id);
  if (!roda) return erro(404, "Troca a três não encontrada.");
  if (!roda.pernas.some((p) => p.internId === ator.id)) return erro(403, "Você não participa desta troca a três.");
  if (roda.status !== "PROPOSTA") return erro(409, "Esta troca a três já foi fechada.");

  const foto = await carregarMercado(new Date());
  const nome = primeiro(foto, ator.id);

  if (acao === "recusar") {
    await desfazer(foto, roda, "RECUSADA", `${nome} recusou.`, ator);
    return { status: 200, body: { success: true } };
  }
  if (acao === "cancelar") {
    if (roda.proposedBy !== ator.id) return erro(403, "Só quem propôs pode cancelar. Você pode recusar.");
    await desfazer(foto, roda, "CANCELADA", `${nome} cancelou a proposta.`, ator);
    return { status: 200, body: { success: true } };
  }

  // Confirmar: a roda tem que fechar de novo com a escala de agora.
  const pernas = pernasDaGravada(foto, roda);
  if (!pernas) {
    await desfazer(foto, roda, "CANCELADA", "um dos plantões mudou ou saiu da escala.", ator);
    return erro(409, "Um dos plantões mudou ou saiu da escala. A troca a três foi desfeita.");
  }
  if (pernas.some((p) => hasShiftStarted(p.entrega.date.slice(0, 10), p.entrega.period, p.entrega.shift, foto.ctx.agora))) {
    await desfazer(foto, roda, "EXPIRADA", "um dos plantões já começou.", ator);
    return erro(409, "Um dos plantões já começou. A troca a três expirou.");
  }
  await cotaDosTres(foto, pernas);
  const problema = problemaNaRoda(pernas, foto.ctx, liberadosPara(foto, pernas.map((p) => p.entrega.id), true));
  if (problema) {
    await desfazer(foto, roda, "CANCELADA", problema, ator);
    return erro(409, `${problema} A troca a três foi desfeita.`);
  }

  await confirmarPerna(roda.id, ator.id);
  await logAudit({ userId: ator.realUserId ?? ator.id, action: AUDIT_RODA.CONFIRMADA, entity: "swap_cycle", entityId: roda.id, payload: {} });

  const faltam = roda.pernas.filter((p) => p.internId !== ator.id && !p.confirmedAt);
  if (faltam.length > 0) return { status: 200, body: { success: true, data: { concluida: false, faltam: faltam.length } } };

  const aplicada = await aplicarRoda({ cycleId: roda.id, aplicadoPor: ator.realUserId ?? ator.id }).catch((e) => {
    console.warn(`[roda] aplicar falhou: ${e instanceof Error ? e.message : e}`);
    return false;
  });
  if (!aplicada) return erro(409, "Não deu para aplicar a troca a três agora: um dos plantões mudou. Tente de novo.");

  await logAudit({
    userId: ator.realUserId ?? ator.id,
    action: AUDIT_RODA.CONCLUIDA,
    entity: "swap_cycle",
    entityId: roda.id,
    payload: { pernas: pernas.map((p) => ({ internId: p.internId, entrega: p.entrega.id, recebe: p.recebe.id })) },
  });
  await avisar(pernas.map((p, i) => ({
    para: p.internId,
    texto: textoRodaFechada(pernaAvisada(foto, pernas, i)),
    action: AUDIT_RODA.AVISO,
    entityId: p.internId,
    payload: { roda: roda.id, etapa: "CONCLUIDA" },
  })));
  return { status: 200, body: { success: true, data: { concluida: true } } };
}
