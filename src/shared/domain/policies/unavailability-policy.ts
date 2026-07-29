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

/**
 * De onde vem um bloqueio. Só `DECLARADA` é digitada pelo interno; as outras
 * duas o sistema deduz, e por isso não gastam a cota dele.
 */
export const ORIGENS_BLOQUEIO = ["SAMU", "AULA_FIXA", "DECLARADA"] as const;
export type OrigemBloqueio = (typeof ORIGENS_BLOQUEIO)[number];

export const ROTULO_ORIGEM: Record<OrigemBloqueio, string> = {
  SAMU: "SAMU",
  AULA_FIXA: "Aula",
  DECLARADA: "Indisponível",
};

/**
 * Faculdades com dia fixo de aula, e o dia da semana (0 = domingo).
 *
 * A UNIFACS tem aula às segundas, o dia inteiro — não adianta escalar de manhã
 * nem à noite. Fica em tabela versionada, e não em banco, pela mesma razão de
 * src/lib/instance.ts: a regra aparece no diff, e ninguém a muda calado.
 */
export const DIA_DE_AULA_POR_FACULDADE: Record<string, number> = {
  UNIFACS: 1, // segunda-feira
};

/** A faculdade tem aula nesse dia? Bloqueia o dia inteiro (diurno e noturno). */
export function ehDiaDeAulaFixa(facultyAbbr: string | null | undefined, dateStr: string): boolean {
  if (!facultyAbbr) return false;
  const diaDeAula = DIA_DE_AULA_POR_FACULDADE[facultyAbbr.toUpperCase()];
  if (diaDeAula === undefined) return false;
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay() === diaDeAula;
}

export const MOTIVOS_INDISPONIBILIDADE = ["CRU_SAMU", "USA_SAMU", "AULA", "LIVRE"] as const;
export type MotivoIndisponibilidade = (typeof MOTIVOS_INDISPONIBILIDADE)[number];

export type ShiftPeriod = "DAY" | "NIGHT";

export type Indisponibilidade = {
  date: string; // YYYY-MM-DD
  period: ShiftPeriod;
  reason: MotivoIndisponibilidade;
};

/**
 * Teto por motivo.
 *
 * CRU_SAMU e USA_SAMU valem 0 porque **deixaram de ser digitados**: a escala do
 * SAMU é lida direto do banco de lá (samu-schedule-repository.ts), então pedir
 * ao interno que declare seria pedir de novo o que já se sabe — e aceitar que
 * ele erre ou esqueça. Os dois nomes continuam no enum porque linhas antigas
 * gravadas antes dessa mudança precisam continuar legíveis.
 *
 * AULA idem: a segunda-feira da UNIFACS sai de DIA_DE_AULA_POR_FACULDADE.
 *
 * Sobra LIVRE: os dois turnos que o interno escolhe pelo motivo que for.
 */
export const TETO_POR_MOTIVO: Record<MotivoIndisponibilidade, number> = {
  CRU_SAMU: 0,
  USA_SAMU: 0,
  AULA: 0,
  LIVRE: 2,
};

export const TETO_TOTAL = 2;

export const ROTULO_MOTIVO: Record<MotivoIndisponibilidade, string> = {
  CRU_SAMU: "CRU SAMU",
  USA_SAMU: "USA SAMU",
  AULA: "Aula",
  LIVRE: "Indisponibilidade",
};

/**
 * Motivos que o interno ainda escolhe na tela — os de teto maior que zero.
 *
 * Derivado do teto, e não escrito à mão, para que zerar um motivo o tire do
 * formulário sozinho: não dá para ficar oferecendo na tela algo que a validação
 * vai recusar.
 */
export const MOTIVOS_DECLARAVEIS = MOTIVOS_INDISPONIBILIDADE.filter(
  (motivo) => TETO_POR_MOTIVO[motivo] > 0,
);

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
