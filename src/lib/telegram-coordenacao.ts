/**
 * O bot do Taximetro conta à coordenação, no privado, o que aconteceu no
 * turno: aviso do interno, interno que mudou de base sozinho, intervenção de
 * outro coordenador. Vai para todo COORDINATOR ativo que fez /vincular.
 *
 * Como o aviso ao secretário `tom`: cortesia, nunca levanta. Devolve quantos
 * receberam, para quem chamou decidir o que dizer ("coordenação avisada" ou
 * "ligue para a coordenação").
 */

import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, bases, faculties, telegramBindings, userRoles, users } from "@/db/schema";
import { bot, TELEGRAM_BOT_TOKEN } from "@/lib/telegram";
import { ORG_BASE_URL } from "@/lib/branding";
import { formatBrazilTime, operationalDateStr, operationalPeriod } from "@/lib/utils";
import { avisoDaBase, MARCA_REPOR, resumoDoTurnoParaTelegram } from "@/lib/plantao-ao-vivo";
import { vagasNaGrade } from "@/lib/remanejamento-interno";
import { basesDoTurno } from "@/features/scheduling/application/grade-do-turno";

export async function avisarCoordenacaoNoTelegram(texto: string, opts: { exceto?: string } = {}): Promise<number> {
  if (!TELEGRAM_BOT_TOKEN) return 0;
  try {
    const condicoes = [eq(userRoles.role, "COORDINATOR"), eq(userRoles.isActive, true), eq(users.isActive, true)];
    if (opts.exceto) condicoes.push(ne(userRoles.userId, opts.exceto));
    const destinos = await db
      .selectDistinct({ chatId: telegramBindings.telegramUserId })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .innerJoin(telegramBindings, eq(telegramBindings.userId, userRoles.userId))
      .where(and(...condicoes));
    if (destinos.length === 0) return 0;

    const envios = await Promise.allSettled(
      destinos.map(async (d) => {
        try {
          await bot.api.sendMessage(d.chatId, texto, { parse_mode: "Markdown" });
        } catch {
          // Nome com caractere que o Markdown legado não engole: manda sem formatação.
          await bot.api.sendMessage(d.chatId, texto.replaceAll("*", ""));
        }
      }),
    );
    return envios.filter((e) => e.status === "fulfilled").length;
  } catch (erro) {
    console.warn(`[telegram] aviso à coordenação falhou: ${erro instanceof Error ? erro.message : erro}`);
    return 0;
  }
}

/** O turno em andamento, resumido, para o comando /plantao no privado do bot. */
export async function resumoDoTurno(): Promise<string> {
  const date = operationalDateStr();
  const period = operationalPeriod();
  const [{ bases: lista }, liberados] = await Promise.all([
    basesDoTurno(date, period),
    db
      .select({ interno: users.name, faculdade: faculties.abbreviation, baseCode: bases.code })
      .from(assignments)
      .innerJoin(users, eq(users.id, assignments.internId))
      .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
      .innerJoin(bases, eq(bases.id, assignments.baseId))
      .where(
        and(
          eq(assignments.date, date),
          eq(assignments.period, period),
          eq(assignments.status, "CANCELLED"),
          sql`${assignments.notes} LIKE ${`%${MARCA_REPOR}%`}`,
        ),
      ),
  ]);
  return resumoDoTurnoParaTelegram({
    period,
    dataFormatada: new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    agora: formatBrazilTime(new Date()),
    bases: lista.map((b) => ({
      code: b.code,
      aviso: avisoDaBase(b.estado),
      parada: b.estado.parada,
      desativada: b.desativada,
      livres: b.estado.parada || b.desativada || avisoDaBase(b.estado) ? 0 : vagasNaGrade({ capacity: b.capacity, occupied: b.ocupantes.length }),
    })),
    liberados,
    url: `${ORG_BASE_URL}/taximetro/admin/plantao`,
  });
}
