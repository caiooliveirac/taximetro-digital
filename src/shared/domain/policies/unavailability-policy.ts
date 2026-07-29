/**
 * Regra das indisponibilidades do interno (instância Vitalmed).
 *
 * O interno avisa em quais turnos da semana não pode pegar plantão. O teto é
 * por motivo, não só no total:
 *
 *   - no máximo 1 turno por CRU SAMU
 *   - no máximo 1 turno por USA SAMU
 *   - no máximo 2 turnos por AULA
 *   - no máximo 4 no total
 *
 * O teto por motivo existe porque o interno da Vitalmed também faz o internato
 * no SAMU: CRU_SAMU e USA_SAMU são plantões dele lá (um de cada por semana), e
 * AULA é compromisso da faculdade. Declarar menos é permitido — quem só tem
 * aula numa tarde marca uma e pronto.
 *
 * Arquivo sem dependência de banco nem de framework de propósito: é a regra de
 * negócio, e precisa ser testável direto (tests/unavailability-policy.test.ts).
 */

export const MOTIVOS_INDISPONIBILIDADE = ["CRU_SAMU", "USA_SAMU", "AULA"] as const;
export type MotivoIndisponibilidade = (typeof MOTIVOS_INDISPONIBILIDADE)[number];

export type ShiftPeriod = "DAY" | "NIGHT";

export type Indisponibilidade = {
  date: string; // YYYY-MM-DD
  period: ShiftPeriod;
  reason: MotivoIndisponibilidade;
};

/** Teto por motivo. A soma dos tetos (4) é o teto total — não é coincidência. */
export const TETO_POR_MOTIVO: Record<MotivoIndisponibilidade, number> = {
  CRU_SAMU: 1,
  USA_SAMU: 1,
  AULA: 2,
};

export const TETO_TOTAL = 4;

export const ROTULO_MOTIVO: Record<MotivoIndisponibilidade, string> = {
  CRU_SAMU: "CRU SAMU",
  USA_SAMU: "USA SAMU",
  AULA: "Aula",
};

export type ResultadoValidacao =
  | { ok: true }
  | { ok: false; motivo: string };

/**
 * A semana declarada é válida?
 *
 * Recebe a lista inteira da semana (e não o item novo isolado) porque toda
 * regra aqui é sobre o conjunto — validar item a item deixaria passar a
 * combinação inválida.
 */
export function validarSemana(itens: Indisponibilidade[]): ResultadoValidacao {
  if (itens.length > TETO_TOTAL) {
    return {
      ok: false,
      motivo: `São no máximo ${TETO_TOTAL} turnos de indisponibilidade por semana (foram ${itens.length}).`,
    };
  }

  const vistos = new Set<string>();
  for (const item of itens) {
    const chave = `${item.date}|${item.period}`;
    if (vistos.has(chave)) {
      return {
        ok: false,
        motivo: `O turno de ${item.date} (${item.period === "DAY" ? "dia" : "noite"}) foi declarado duas vezes.`,
      };
    }
    vistos.add(chave);
  }

  for (const motivo of MOTIVOS_INDISPONIBILIDADE) {
    const quantos = itens.filter((item) => item.reason === motivo).length;
    const teto = TETO_POR_MOTIVO[motivo];
    if (quantos > teto) {
      const rotulo = ROTULO_MOTIVO[motivo];
      return {
        ok: false,
        motivo:
          teto === 1
            ? `Só é possível declarar 1 turno por ${rotulo} (foram ${quantos}).`
            : `São no máximo ${teto} turnos por ${rotulo} (foram ${quantos}).`,
      };
    }
  }

  return { ok: true };
}

/** Quanto ainda cabe em cada motivo — alimenta a tela do interno. */
export function saldoPorMotivo(
  itens: Indisponibilidade[],
): Record<MotivoIndisponibilidade, number> {
  const saldo = {} as Record<MotivoIndisponibilidade, number>;
  for (const motivo of MOTIVOS_INDISPONIBILIDADE) {
    const usados = itens.filter((item) => item.reason === motivo).length;
    saldo[motivo] = Math.max(0, TETO_POR_MOTIVO[motivo] - usados);
  }
  return saldo;
}

/**
 * Segunda-feira da semana de uma data (ISO, YYYY-MM-DD).
 *
 * O teto é semanal, então toda validação precisa concordar sobre onde a semana
 * começa. Meio-dia UTC evita que fuso empurre a data para o dia anterior.
 */
export function inicioDaSemana(dateStr: string): string {
  const data = new Date(`${dateStr}T12:00:00Z`);
  const diaDaSemana = data.getUTCDay(); // 0 = domingo
  const recuo = diaDaSemana === 0 ? 6 : diaDaSemana - 1;
  data.setUTCDate(data.getUTCDate() - recuo);
  return data.toISOString().slice(0, 10);
}

/** As 7 datas da semana que contém `dateStr`, de segunda a domingo. */
export function datasDaSemana(dateStr: string): string[] {
  const inicio = inicioDaSemana(dateStr);
  const datas: string[] = [];
  for (let i = 0; i < 7; i++) {
    const data = new Date(`${inicio}T12:00:00Z`);
    data.setUTCDate(data.getUTCDate() + i);
    datas.push(data.toISOString().slice(0, 10));
  }
  return datas;
}
