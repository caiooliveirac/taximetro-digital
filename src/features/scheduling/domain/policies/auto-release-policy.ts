/**
 * Liberação automática de vagas — a regra, sem banco.
 *
 * Duas fontes de vaga livre, ambas só na intervenção (bases USA):
 *
 * 1. PRAZO — a turma tem `deadlineDays` dias, contados do início dela, para
 *    escalar os internos nas vagas da grade da faculdade. Passado o prazo, a
 *    vaga que ninguém ocupou vira vaga liberada (como se o líder tivesse
 *    liberado à mão) e qualquer outro líder pode usar.
 * 2. SEM_DONO — a base comporta mais internos do que a soma da grade de todas
 *    as faculdades naquele dia/turno. O que sobra fica livre desde já, nos
 *    dias que alguma turma aberta cobre (do início ao fim do rodízio dela).
 *
 * Teto por base (CAPACIDADE_USA): é o que trava a liberação. Diurno cabem dois
 * em toda USA, menos BR60 e BR05, que nunca liberam a segunda vaga. Noturno
 * cabe um, e dois só nas bases de NOITE_DUPLA. Base fora da tabela (LF90, que
 * só abre em dias escolhidos) não ganha vaga sem dono: o teto dela é a grade.
 */

export type Periodo = "DAY" | "NIGHT";
export type OrigemAutomatica = "PRAZO" | "SEM_DONO";

/** Prazo padrão, em dias, para faculdade sem configuração salva. */
export const PRAZO_PADRAO_DIAS = 3;

/**
 * Faculdade sem configuração salva conta o prazo a partir daqui: no dia em que
 * o mecanismo entrou no ar, as turmas já em andamento ganharam os mesmos dias
 * de prazo de uma turma nova, em vez de perderem a vaga sem aviso.
 */
export const LIBERACAO_AUTOMATICA_DESDE = "2026-10-27";


const DIURNO_UMA_VAGA = new Set(["BR60", "BR05"]);
const NOITE_DUPLA = new Set(["SM01", "CB02", "PR03", "CN10", "CC70"]);
const FORA_DA_TABELA = new Set(["LF90"]);

/** Teto de internos na base no turno; null = sem teto próprio (vale a grade). */
export function capacidadeDaBase(baseCode: string, period: Periodo): number | null {
  if (FORA_DA_TABELA.has(baseCode)) return null;
  if (period === "DAY") return DIURNO_UMA_VAGA.has(baseCode) ? 1 : 2;
  return NOITE_DUPLA.has(baseCode) ? 2 : 1;
}

function somaDias(dateStr: string, dias: number) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Primeiro dia em que a vaga não usada da turma é liberada. Início 26/10 com
 * prazo de 3 dias: 26, 27 e 28 para escalar, libera em 29/10.
 */
export function dataDeLiberacao(params: { cohortStart: string; enabledSince: string; deadlineDays: number }) {
  const inicio = params.cohortStart > params.enabledSince ? params.cohortStart : params.enabledSince;
  return somaDias(inicio, Math.max(params.deadlineDays, 0));
}

export type FaculdadeNaVaga = {
  facultyId: string;
  /** Capacidade da grade da faculdade na base/dia/turno. */
  capacity: number;
  /** Regra bloqueada pela coordenação: conta como da faculdade, nunca libera. */
  blocked: boolean;
  /** Prazo da turma que cobre a data já venceu e o mecanismo está ligado. */
  eligible: boolean;
  /** Plantões não cancelados da faculdade nesta base/dia/turno. */
  assigned: number;
  /**
   * Ofertas que a faculdade já cedeu aqui: vivas (pegas ou não) e as
   * automáticas que o líder desfez — desfeita não volta a ser liberada.
   */
  alreadyReleased: number;
};

export type PlanoDaVaga = {
  /** Quantas vagas liberar em nome de cada faculdade. */
  porFaculdade: Map<string, number>;
  semDono: number;
};

/**
 * Decide o que liberar numa base/data/turno.
 *
 * `room` é o espaço físico que sobra na base: teto menos quem já está escalado,
 * menos ofertas abertas, menos as vagas da grade de faculdade que ainda está no
 * prazo (ou bloqueada) — essas são dela e não podem ser dadas a outro.
 */
export function planejarVaga(params: {
  cap: number | null;
  faculdades: FaculdadeNaVaga[];
  /** Plantões não cancelados de qualquer faculdade na base/dia/turno. */
  totalAssigned: number;
  /** Ofertas vivas ainda não pegas (liberadas, sem dono, reservas). */
  openOffers: number;
  /** Sem dono já criadas aqui, vivas ou canceladas pela coordenação. */
  semDonoExistentes: number;
}): PlanoDaVaga {
  const naoUsada = (f: FaculdadeNaVaga) => Math.max(f.capacity - f.assigned - f.alreadyReleased, 0);
  const somaGrade = params.faculdades.reduce((n, f) => n + f.capacity, 0);
  const teto = params.cap ?? somaGrade;

  const presas = params.faculdades
    .filter((f) => f.blocked || !f.eligible)
    .reduce((n, f) => n + naoUsada(f), 0);
  let room = teto - params.totalAssigned - params.openOffers - presas;

  const porFaculdade = new Map<string, number>();
  for (const f of params.faculdades) {
    if (f.blocked || !f.eligible || room <= 0) continue;
    const n = Math.min(naoUsada(f), room);
    if (n > 0) {
      porFaculdade.set(f.facultyId, (porFaculdade.get(f.facultyId) ?? 0) + n);
      room -= n;
    }
  }

  const semDonoCap = params.cap === null ? 0 : Math.max(params.cap - somaGrade, 0);
  const semDono = Math.max(Math.min(semDonoCap - params.semDonoExistentes, room), 0);

  return { porFaculdade, semDono };
}
