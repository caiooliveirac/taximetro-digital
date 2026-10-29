/**
 * Troca a três (roda): cada interno entrega um plantão e recebe o do anterior.
 *
 * Fazer a roda com duas trocas em dupla quebra em três pontos: a cota de CRU
 * conta duas trocas para quem fica no meio, o descanso de 12h é cobrado no
 * estado intermediário (que ninguém quer), e se o terceiro desiste o do meio
 * fica preso com um plantão que não pediu. Aqui a roda é uma coisa só: as
 * regras valem para o resultado final, e ou aplica tudo ou nada.
 *
 * Achar rodas é script, sem modelo (como as cadeias do escalasetrocasSAMU):
 * parte de quem precisa sair de um plantão — ofertou, ou ele colide com o
 * outro serviço — e de quem marcou Quero/Posso no turno desse plantão.
 *   Ana sai do dia A, que Bruno marcou; Bruno sai do dia B, que Carla marcou;
 *   Carla sai do dia C. Se Ana pegar o C, a roda fecha.
 */
import { podeTrocarEntreFaculdades } from "./cross-faculty-swap-policy";
import {
  cabe,
  colideComOutroServico,
  descrevePlantao,
  plantaoTrocavel,
  type ContextoDoMercado,
  type OfertaAberta,
  type PlantaoDoMercado,
} from "./swap-match-policy";

export type PernaDaRoda = { internId: string; entrega: PlantaoDoMercado; recebe: PlantaoDoMercado };

const TIPO: Record<string, string> = { USA: "Ambulância", CENTRAL: "Regulação", CRL: "Leitos" };
const chave = (p: { date: string; period: string }) => `${p.date.slice(0, 10)}|${p.period}`;

/** Quem está na posição i entrega para a posição i+1 (e a última para a primeira). */
export function montarRoda(entregas: PlantaoDoMercado[]): PernaDaRoda[] {
  return entregas.map((entrega, i) => ({
    internId: entrega.internId,
    entrega,
    recebe: entregas[(i - 1 + entregas.length) % entregas.length],
  }));
}

function primeiroNome(ctx: ContextoDoMercado, internId: string) {
  return (ctx.nomes.get(internId) ?? "Um colega").trim().split(/\s+/)[0];
}

/**
 * Por que esta roda não pode ser aplicada, ou null se pode. `liberados` são
 * plantões que estão "em solicitação" mas podem entrar (as ofertas abertas de
 * quem está na roda, e a própria roda quando é ela que está sendo confirmada).
 */
export function problemaNaRoda(pernas: PernaDaRoda[], ctx: ContextoDoMercado, liberados: Set<string> = new Set()): string | null {
  if (pernas.length !== 3) return "A troca a três precisa de três plantões.";
  if (new Set(pernas.map((p) => p.internId)).size !== 3) return "A roda precisa de três pessoas diferentes.";

  const tipo = pernas[0].entrega.baseType;
  if (pernas.some((p) => p.entrega.baseType !== tipo)) {
    return "Os três plantões precisam ser do mesmo tipo (Ambulância, Regulação ou Leitos).";
  }
  if (new Set(pernas.map((p) => Boolean(p.entrega.shift))).size > 1) {
    return "Meio turno não troca com plantão de 12h.";
  }

  for (const p of pernas) {
    const nome = primeiroNome(ctx, p.internId);
    if (!plantaoTrocavel(p.entrega, ctx.agora)) {
      return `O plantão de ${nome} (${descrevePlantao(p.entrega)}) não pode mais ser trocado.`;
    }
    if (ctx.bloqueados.has(p.entrega.id) && !liberados.has(p.entrega.id)) {
      return `O plantão de ${nome} (${descrevePlantao(p.entrega)}) já está em outra troca.`;
    }
    // A faculdade de quem recebe é a do plantão que ele entrega.
    if (p.recebe.facultyId !== p.entrega.facultyId && !podeTrocarEntreFaculdades(tipo)) {
      return `${TIPO[tipo] ?? tipo} só troca dentro da faculdade, e a roda passa por faculdades diferentes.`;
    }
    if (tipo === "CENTRAL" && ctx.cotaCruUsada.has(p.internId)) {
      return `${nome} já trocou um plantão de CRU neste rodízio.`;
    }
    if (!cabe(ctx, p.internId, p.recebe, p.entrega)) {
      return `${nome} ficaria sem 12h de descanso com ${descrevePlantao(p.recebe)}.`;
    }
  }
  return null;
}

export type RodaSugerida = {
  pernas: PernaDaRoda[];
  /** Pernas em que quem recebe marcou Quero/Posso no turno: 2 ou 3. */
  sinalizadas: number;
  /** Assinatura estável: os três plantões, em ordem — para não sugerir duas vezes. */
  assinatura: string;
};

/** Plantões de que cada interno precisa sair: os que ofertou e os que colidem com o outro serviço. */
function saidas(ctx: ContextoDoMercado, ofertas: OfertaAberta[]) {
  const m = new Map<string, PlantaoDoMercado[]>();
  const add = (p: PlantaoDoMercado) => {
    const l = m.get(p.internId) ?? [];
    if (!l.some((x) => x.id === p.id)) m.set(p.internId, [...l, p]);
  };
  for (const o of ofertas) add(o.plantao);
  for (const p of ctx.plantoes) if (plantaoTrocavel(p, ctx.agora) && colideComOutroServico(ctx, p)) add(p);
  return m;
}

/**
 * Rodas de três que fecham com as disponibilidades de hoje: todo mundo na roda
 * precisa sair de um plantão, pelo menos duas pernas foram pedidas (Quero/
 * Posso de quem recebe), e o resultado final passa em `problemaNaRoda`.
 * Com as três pernas pedidas, vem primeiro.
 */
export function encontrarRodas(ctx: ContextoDoMercado, ofertas: OfertaAberta[]): RodaSugerida[] {
  const saem = saidas(ctx, ofertas);
  const queremNoTurno = new Map<string, Set<string>>();
  for (const s of ctx.sinais) {
    if (s.signal !== "QUERO" && s.signal !== "POSSO") continue;
    const k = chave(s);
    queremNoTurno.set(k, (queremNoTurno.get(k) ?? new Set()).add(s.internId));
  }
  const ofertados = new Set(ofertas.map((o) => o.plantao.id));

  const achadas = new Map<string, RodaSugerida>();
  for (const [a, saidasA] of saem) {
    for (const pa of saidasA) {
      for (const b of queremNoTurno.get(chave(pa)) ?? []) {
        if (b === a) continue;
        for (const pb of saem.get(b) ?? []) {
          if (pb.baseType !== pa.baseType) continue;
          for (const c of queremNoTurno.get(chave(pb)) ?? []) {
            if (c === a || c === b) continue;
            for (const pc of saem.get(c) ?? []) {
              if (pc.baseType !== pa.baseType) continue;
              const pernas = montarRoda([pa, pb, pc]);
              // Ofertas abertas de quem está na roda podem entrar: a roda as fecha.
              const liberados = new Set([pa, pb, pc].filter((p) => ofertados.has(p.id)).map((p) => p.id));
              if (problemaNaRoda(pernas, ctx, liberados)) continue;
              const assinatura = [pa.id, pb.id, pc.id].sort().join(":");
              const sinalizadas = 2 + (queremNoTurno.get(chave(pc))?.has(a) ? 1 : 0);
              const atual = achadas.get(assinatura);
              if (!atual || atual.sinalizadas < sinalizadas) achadas.set(assinatura, { pernas, sinalizadas, assinatura });
            }
          }
        }
      }
    }
  }
  return [...achadas.values()].sort(
    (x, y) => y.sinalizadas - x.sinalizadas ||
      Math.min(...x.pernas.map((p) => Date.parse(p.entrega.date))) - Math.min(...y.pernas.map((p) => Date.parse(p.entrega.date))),
  );
}

/** Para quem está na roda: o que ele entrega e o que recebe, e se pediu o que recebe. */
export function minhaPerna(roda: RodaSugerida, internId: string, ctx: ContextoDoMercado) {
  const p = roda.pernas.find((x) => x.internId === internId);
  if (!p) return null;
  const pediu = ctx.sinais.some(
    (s) => s.internId === internId && (s.signal === "QUERO" || s.signal === "POSSO") && chave(s) === chave(p.recebe),
  );
  return { ...p, pediu };
}
