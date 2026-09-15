/**
 * O que o app `plantoes` (schema `operations_v2`) sabe de cada base agora:
 * qual médico de intervenção está lá, e se o chefe de plantão desativou a base.
 *
 * Serve ao remanejamento pelo interno: antes de ir para outra base, ele vê que
 * médico vai encontrar e não é oferecido a uma base que o `plantoes` já fechou.
 * É informação de cortesia — sem `PLANTOES_READONLY_DATABASE_URL` (SAMU em
 * dev, Vitalmed sempre) ou com o banco fora, a grade sai sem nomes e sem
 * desativações e nada mais muda. Por isso esta leitura NUNCA levanta, ao
 * contrário da leitura da escala do SAMU pela Vitalmed, onde vazio silencioso
 * escalaria alguém ocupado.
 *
 * Os códigos das bases são os mesmos nos dois apps (SM01, CB02, BR05...); o
 * join é por `code`. O role de leitura precisa de SELECT em
 * intervention_occupancies, intervention_bases, intervention_base_deactivations
 * e doctors.
 *
 * "Está na base agora" segue o quadro do `plantoes`: chegou, não registrou
 * saída real, e a janela programada ainda não fechou. Médico que saiu sem
 * registrar continua aparecendo até o fim da janela — é o que o quadro deles
 * também mostra. "Desativada" é a janela de desativação aberta agora: o chefe
 * costuma registrar a reativação já com a hora prevista do fim do turno.
 */

import postgres from "postgres";

export type Desativacao = { desde: string; motivo: string | null };

export type EstadoNoPlantoes = {
  medicos: Record<string, string[]>;
  desativadas: Record<string, Desativacao>;
};

let conexao: ReturnType<typeof postgres> | null = null;

function obterConexao() {
  const url = process.env.PLANTOES_READONLY_DATABASE_URL?.trim();
  if (!url) return null;
  conexao ??= postgres(url, { max: 2, prepare: false, idle_timeout: 20, connect_timeout: 5 });
  return conexao;
}

export function canalDoPlantoesConfigurado(): boolean {
  return Boolean(process.env.PLANTOES_READONLY_DATABASE_URL?.trim());
}

export async function estadoDasBasesNoPlantoes(codigos: string[]): Promise<EstadoNoPlantoes> {
  const vazio: EstadoNoPlantoes = { medicos: {}, desativadas: {} };
  const sql = obterConexao();
  if (!sql || codigos.length === 0) return vazio;
  try {
    const [presentes, fechadas] = await Promise.all([
      sql<Array<{ code: string; nome: string }>>`
        SELECT b.code, COALESCE(NULLIF(d.display_name, ''), d.full_name) AS nome
        FROM operations_v2.intervention_occupancies o
        JOIN operations_v2.intervention_bases b ON b.id = o.base_id
        JOIN operations_v2.doctors d ON d.id = o.doctor_id
        WHERE b.code = ANY(${codigos})
          AND o.started_at <= now()
          AND o.started_at > now() - interval '24 hours'
          AND o.actual_ended_at IS NULL
          AND (o.ended_at IS NULL OR o.ended_at > now())
          AND (o.scheduled_end_at IS NULL OR o.scheduled_end_at > now())
        ORDER BY b.code, o.started_at
      `,
      sql<Array<{ code: string; desde: string; motivo: string | null }>>`
        SELECT DISTINCT ON (b.code) b.code, x.deactivated_at::text AS desde, x.notes AS motivo
        FROM operations_v2.intervention_base_deactivations x
        JOIN operations_v2.intervention_bases b ON b.id = x.base_id
        WHERE b.code = ANY(${codigos})
          AND x.deactivated_at <= now()
          AND (x.reactivated_at IS NULL OR x.reactivated_at > now())
        ORDER BY b.code, x.deactivated_at DESC
      `,
    ]);
    const medicos: Record<string, string[]> = {};
    for (const l of presentes) (medicos[l.code] ??= []).push(l.nome);
    const desativadas: Record<string, Desativacao> = {};
    for (const l of fechadas) desativadas[l.code] = { desde: l.desde, motivo: l.motivo?.trim() || null };
    return { medicos, desativadas };
  } catch (erro) {
    console.warn(`[plantoes] leitura do estado das bases falhou: ${erro instanceof Error ? erro.message : erro}`);
    return vazio;
  }
}
