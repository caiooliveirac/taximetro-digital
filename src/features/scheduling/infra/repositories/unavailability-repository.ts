/**
 * Persistência das indisponibilidades declaradas pelo interno.
 *
 * A regra de teto vive em src/shared/domain/policies/unavailability-policy.ts —
 * aqui só entra acesso a banco.
 */

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { internUnavailability, userRoles, users } from "@/shared/db/schema";
import {
  ehDiaDeAulaFixa,
  type Indisponibilidade,
  type OrigemBloqueio,
} from "@/shared/domain/policies/unavailability-policy";
import {
  canalDoSamuConfigurado,
  lerPlantoesDoSamu,
} from "./samu-schedule-repository";

export type ItemPersistido = Indisponibilidade & {
  id: string;
  internId: string;
  notes: string | null;
};

/** Indisponibilidades de um interno numa faixa de datas (a semana, na prática). */
export async function listarPorInterno(params: {
  internId: string;
  dateFrom: string;
  dateTo: string;
}): Promise<ItemPersistido[]> {
  const linhas = await db
    .select({
      id: internUnavailability.id,
      internId: internUnavailability.internId,
      date: internUnavailability.date,
      period: internUnavailability.period,
      reason: internUnavailability.reason,
      notes: internUnavailability.notes,
    })
    .from(internUnavailability)
    .where(
      and(
        eq(internUnavailability.internId, params.internId),
        gte(internUnavailability.date, params.dateFrom),
        lte(internUnavailability.date, params.dateTo),
      ),
    );

  return linhas as ItemPersistido[];
}

/**
 * Mapa que o sorteio consome: internId → Set("date|period").
 *
 * Formato igual ao de `cruBlocked` de propósito — o alocador já sabe lidar com
 * ele, então a indisponibilidade entra como mais um bloqueio, sem caminho novo.
 */
export async function mapaDeBloqueioPorInterno(params: {
  internIds: string[];
  dateFrom: string;
  dateTo: string;
}): Promise<Map<string, Set<string>>> {
  const mapa = new Map<string, Set<string>>();
  if (params.internIds.length === 0) return mapa;

  const linhas = await db
    .select({
      internId: internUnavailability.internId,
      date: internUnavailability.date,
      period: internUnavailability.period,
    })
    .from(internUnavailability)
    .where(
      and(
        inArray(internUnavailability.internId, params.internIds),
        gte(internUnavailability.date, params.dateFrom),
        lte(internUnavailability.date, params.dateTo),
      ),
    );

  for (const linha of linhas) {
    if (!mapa.has(linha.internId)) mapa.set(linha.internId, new Set());
    mapa.get(linha.internId)!.add(`${linha.date}|${linha.period}`);
  }
  return mapa;
}

export type InternoParaBloqueio = {
  id: string;
  cpf: string | null;
  facultyAbbr: string | null;
};

/**
 * Monta a lista para `bloqueiosCompostos` a partir dos ids.
 *
 * O CPF é a única chave que atravessa as duas instâncias: os bancos são
 * independentes, então os uuid de um não significam nada no outro.
 */
export async function internosParaBloqueio(params: {
  internIds: string[];
  facultyAbbr: string | null;
}): Promise<InternoParaBloqueio[]> {
  if (params.internIds.length === 0) return [];
  const linhas = await db
    .select({ id: users.id, cpf: users.cpf })
    .from(users)
    .where(inArray(users.id, params.internIds));

  return linhas.map((linha) => ({
    id: linha.id,
    cpf: linha.cpf,
    facultyAbbr: params.facultyAbbr,
  }));
}

export type EstadoDoCanalSamu =
  /** Leu a escala do SAMU com sucesso. */
  | "ok"
  /** Instância sem canal (SAMU, dev): ausência esperada. */
  | "ausente"
  /** Canal existe mas falhou — os avisos de SAMU estão incompletos. */
  | "falhou";

export type BloqueiosCompostos = {
  /** internId → ("date|period" → por que está bloqueado). */
  mapa: Map<string, Map<string, OrigemBloqueio>>;
  samu: EstadoDoCanalSamu;
};

/**
 * As três origens de bloqueio num mapa só.
 *
 * Ordem de precedência quando o mesmo turno é bloqueado por mais de uma origem:
 * SAMU > AULA_FIXA > DECLARADA. É a ordem do mais externo para o mais escolhido —
 * quem está de plantão no SAMU não está "indisponível por opção", está ocupado,
 * e é isso que a tela precisa mostrar.
 *
 * Não lança se o SAMU falhar: devolve `samu: "falhou"` para quem chama decidir.
 * Alocação manual pode seguir com aviso na tela; o sorteio, que decide em massa
 * e sem ninguém olhando, recusa.
 */
export async function bloqueiosCompostos(params: {
  internos: InternoParaBloqueio[];
  dateFrom: string;
  dateTo: string;
}): Promise<BloqueiosCompostos> {
  const mapa = new Map<string, Map<string, OrigemBloqueio>>();
  const anotar = (internId: string, chave: string, origem: OrigemBloqueio) => {
    if (!mapa.has(internId)) mapa.set(internId, new Map());
    const doInterno = mapa.get(internId)!;
    // Só sobrescreve com origem de maior precedência.
    const atual = doInterno.get(chave);
    if (atual === "SAMU") return;
    if (atual === "AULA_FIXA" && origem === "DECLARADA") return;
    doInterno.set(chave, origem);
  };

  if (params.internos.length === 0) return { mapa, samu: "ausente" };

  // 1. Declarada pelo interno (banco da Vitalmed).
  const declaradas = await mapaDeBloqueioPorInterno({
    internIds: params.internos.map((interno) => interno.id),
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });
  for (const [internId, chaves] of declaradas) {
    for (const chave of chaves) anotar(internId, chave, "DECLARADA");
  }

  // 2. Aula fixa da faculdade (hoje: segunda-feira da UNIFACS, dia inteiro).
  for (const interno of params.internos) {
    for (const data of datasNoIntervalo(params.dateFrom, params.dateTo)) {
      if (!ehDiaDeAulaFixa(interno.facultyAbbr, data)) continue;
      anotar(interno.id, `${data}|DAY`, "AULA_FIXA");
      anotar(interno.id, `${data}|NIGHT`, "AULA_FIXA");
    }
  }

  // 3. Escala do SAMU (banco de lá, leitura).
  let samu: EstadoDoCanalSamu = canalDoSamuConfigurado() ? "ok" : "ausente";
  if (samu === "ok") {
    const porCpf = new Map<string, string[]>();
    for (const interno of params.internos) {
      const digitos = interno.cpf?.replace(/\D/g, "");
      if (!digitos) continue;
      if (!porCpf.has(digitos)) porCpf.set(digitos, []);
      porCpf.get(digitos)!.push(interno.id);
    }

    try {
      const leitura = await lerPlantoesDoSamu({
        cpfs: [...porCpf.keys()],
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
      });
      for (const plantao of leitura.plantoes) {
        for (const internId of porCpf.get(plantao.cpf) ?? []) {
          anotar(internId, `${plantao.date}|${plantao.period}`, "SAMU");
        }
      }
    } catch (erro) {
      console.error("[indisponibilidade] leitura da escala do SAMU falhou:", erro);
      samu = "falhou";
    }
  }

  return { mapa, samu };
}

/** Datas ISO de `de` até `ate`, inclusive. */
function datasNoIntervalo(de: string, ate: string): string[] {
  const datas: string[] = [];
  const cursor = new Date(`${de}T12:00:00Z`);
  const fim = new Date(`${ate}T12:00:00Z`);
  while (cursor <= fim) {
    datas.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return datas;
}

/**
 * Substitui a semana inteira do interno.
 *
 * Substituição, e não merge, porque a validação de teto é sobre o conjunto: se
 * a gravação fosse item a item, duas chamadas concorrentes poderiam passar cada
 * uma na sua validação e estourar o teto juntas. Apagar e reinserir dentro de
 * uma transação faz o estado final ser sempre um conjunto já validado.
 */
export async function substituirSemana(params: {
  internId: string;
  datasDaSemana: string[];
  itens: Indisponibilidade[];
  createdBy: string;
  notesPorSlot?: Map<string, string | null>;
}): Promise<void> {
  const primeira = params.datasDaSemana[0];
  const ultima = params.datasDaSemana[params.datasDaSemana.length - 1];

  await db.transaction(async (tx) => {
    await tx
      .delete(internUnavailability)
      .where(
        and(
          eq(internUnavailability.internId, params.internId),
          gte(internUnavailability.date, primeira),
          lte(internUnavailability.date, ultima),
        ),
      );

    if (params.itens.length === 0) return;

    await tx.insert(internUnavailability).values(
      params.itens.map((item) => ({
        internId: params.internId,
        date: item.date,
        period: item.period,
        reason: item.reason,
        notes: params.notesPorSlot?.get(`${item.date}|${item.period}`) ?? null,
        createdBy: params.createdBy,
      })),
    );
  });
}

/** Para a tela do admin: indisponibilidades da semana com o nome do interno. */
export async function listarDaSemanaPorFaculdade(params: {
  facultyId: string;
  dateFrom: string;
  dateTo: string;
}): Promise<Array<ItemPersistido & { internName: string }>> {
  const linhas = await db
    .select({
      id: internUnavailability.id,
      internId: internUnavailability.internId,
      date: internUnavailability.date,
      period: internUnavailability.period,
      reason: internUnavailability.reason,
      notes: internUnavailability.notes,
      internName: users.name,
    })
    .from(internUnavailability)
    .innerJoin(users, eq(users.id, internUnavailability.internId))
    // A faculdade do interno vive em user_roles, não em users — um usuário pode
    // ter mais de um papel, e é o papel INTERN que carrega o vínculo.
    .innerJoin(userRoles, eq(userRoles.userId, internUnavailability.internId))
    .where(
      and(
        eq(userRoles.facultyId, params.facultyId),
        eq(userRoles.role, "INTERN"),
        eq(userRoles.isActive, true),
        gte(internUnavailability.date, params.dateFrom),
        lte(internUnavailability.date, params.dateTo),
      ),
    );

  return linhas as Array<ItemPersistido & { internName: string }>;
}
