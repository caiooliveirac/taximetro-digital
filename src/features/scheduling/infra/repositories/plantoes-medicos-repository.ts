/**
 * Quem é o médico de intervenção em cada base agora, lido do banco do app
 * `plantoes` (schema `operations_v2`).
 *
 * Serve ao remanejamento pelo interno: antes de ir para outra base, ele vê que
 * médico vai encontrar lá e pode ligar antes. É informação de cortesia — sem
 * `PLANTOES_READONLY_DATABASE_URL` (SAMU em dev, Vitalmed sempre) ou com o
 * banco fora, a lista de vagas sai sem nomes e nada mais muda. Por isso esta
 * leitura NUNCA levanta, ao contrário da leitura da escala do SAMU pela
 * Vitalmed, onde vazio silencioso escalaria alguém ocupado.
 *
 * Os códigos das bases são os mesmos nos dois apps (SM01, CB02, BR05...); o
 * join é por `code`. O role de leitura precisa de SELECT em
 * intervention_occupancies, intervention_bases e doctors.
 *
 * "Está na base agora" segue o quadro do `plantoes`: chegou, não registrou
 * saída real, e a janela programada ainda não fechou. Médico que saiu sem
 * registrar continua aparecendo até o fim da janela — é o que o quadro deles
 * também mostra.
 */

import postgres from "postgres";

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

/** Código da base -> nomes dos médicos de intervenção presentes agora. */
export async function medicosNasBasesAgora(codigos: string[]): Promise<Record<string, string[]>> {
  const sql = obterConexao();
  if (!sql || codigos.length === 0) return {};
  try {
    const linhas = await sql<Array<{ code: string; nome: string }>>`
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
    `;
    const porBase: Record<string, string[]> = {};
    for (const l of linhas) (porBase[l.code] ??= []).push(l.nome);
    return porBase;
  } catch (erro) {
    console.warn(`[plantoes] leitura de médicos falhou: ${erro instanceof Error ? erro.message : erro}`);
    return {};
  }
}
