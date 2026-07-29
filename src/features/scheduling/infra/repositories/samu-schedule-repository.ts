/**
 * Leitura da escala do SAMU pela instância Vitalmed.
 *
 * As duas instâncias têm bancos isolados de propósito (ver src/lib/instance.ts).
 * Este arquivo é a **única** exceção, e é de mão única: a Vitalmed lê a escala do
 * SAMU para saber quando o interno já está ocupado lá, e nada volta no sentido
 * contrário. O SAMU não sabe que a Vitalmed existe.
 *
 * Por que existe: os 29 internos da Vitalmed são, todos, também internos do SAMU.
 * Antes disso o interno tinha que declarar à mão "tenho CRU no SAMU terça" — uma
 * informação que o banco do SAMU já tem, e que ele podia esquecer ou errar.
 *
 * O que o canal alcança é limitado no banco, não aqui: o role `vitalmed_ro` tem
 * SELECT apenas em users(id, cpf), assignments(intern_id, date, period, status,
 * base_id) e bases(id, code, type). Nome, e-mail, senha e check-ins do SAMU são
 * inalcançáveis por ele — verificado na criação do role.
 *
 * Sem `SAMU_READONLY_DATABASE_URL` o canal simplesmente não existe: é o caso do
 * build do SAMU e do ambiente de dev, que devolvem lista vazia sem erro.
 */

import postgres from "postgres";
import type { ShiftPeriod } from "@/shared/domain/policies/unavailability-policy";

export type PlantaoNoSamu = {
  /** Só dígitos — o join normaliza os dois lados, então formato não importa. */
  cpf: string;
  date: string;
  period: ShiftPeriod;
  /** "USA" | "CENTRAL" | "CRL" — vira o detalhe da tag na tela. */
  baseType: string;
  baseCode: string;
};

export type LeituraDoSamu =
  /** O canal existe e respondeu. */
  | { configurado: true; plantoes: PlantaoNoSamu[] }
  /** Não há canal (SAMU, dev): ausência esperada, não é falha. */
  | { configurado: false; plantoes: [] };

let conexao: ReturnType<typeof postgres> | null = null;

function obterConexao() {
  const url = process.env.SAMU_READONLY_DATABASE_URL?.trim();
  if (!url) return null;
  // Pool pequeno: a consulta é rara (abrir tela de escala, rodar sorteio) e
  // barata — 0,8 ms medido em produção com 7,5 mil linhas em assignments.
  conexao ??= postgres(url, { max: 2, prepare: false, idle_timeout: 20 });
  return conexao;
}

/** O canal com o SAMU está configurado nesta instância? */
export function canalDoSamuConfigurado(): boolean {
  return Boolean(process.env.SAMU_READONLY_DATABASE_URL?.trim());
}

/**
 * Plantões dos internos informados, no intervalo, que os ocupam no SAMU.
 *
 * Inclui **todo** tipo de base — USA, CENTRAL (CRU/CCO) e CRL. Quem está no CRL
 * está tão ocupado quanto quem está na USA; deixar o CRL de fora perderia 16 dos
 * 116 conflitos que existem hoje na janela vigente.
 *
 * `CANCELLED` fica de fora: plantão cancelado no SAMU libera a pessoa aqui.
 *
 * Propaga erro em vez de devolver vazio de propósito. Vazio silencioso, aqui,
 * significaria escalar alguém que está de plantão no SAMU — exatamente o que
 * este canal existe para impedir. Quem chama decide como avisar.
 */
export async function lerPlantoesDoSamu(params: {
  cpfs: string[];
  dateFrom: string;
  dateTo: string;
}): Promise<LeituraDoSamu> {
  const sql = obterConexao();
  if (!sql) return { configurado: false, plantoes: [] };
  if (params.cpfs.length === 0) return { configurado: true, plantoes: [] };

  // Normaliza os dois lados para dígitos: os bancos são independentes e nada
  // garante que a máscara do CPF foi digitada igual nos dois cadastros.
  const digitos = params.cpfs
    .map((cpf) => cpf.replace(/\D/g, ""))
    .filter((cpf) => cpf.length > 0);
  if (digitos.length === 0) return { configurado: true, plantoes: [] };

  const linhas = await sql<Array<{
    cpf: string;
    date: string;
    period: ShiftPeriod;
    base_type: string;
    base_code: string;
  }>>`
    SELECT
      regexp_replace(u.cpf, '[^0-9]', '', 'g') AS cpf,
      to_char(a.date, 'YYYY-MM-DD')            AS date,
      a.period                                 AS period,
      b.type                                   AS base_type,
      b.code                                   AS base_code
    FROM assignments a
    JOIN users u ON u.id = a.intern_id
    JOIN bases b ON b.id = a.base_id
    WHERE regexp_replace(u.cpf, '[^0-9]', '', 'g') = ANY(${digitos})
      AND a.date >= ${params.dateFrom}
      AND a.date <= ${params.dateTo}
      AND a.status <> 'CANCELLED'
  `;

  return {
    configurado: true,
    plantoes: linhas.map((linha) => ({
      cpf: linha.cpf,
      date: linha.date,
      period: linha.period,
      baseType: linha.base_type,
      baseCode: linha.base_code,
    })),
  };
}
