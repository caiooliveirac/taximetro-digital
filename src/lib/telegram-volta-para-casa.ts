import { basesDoTurno } from "@/features/scheduling/application/grade-do-turno";
import { logAudit } from "@/lib/audit";
import { bot, TELEGRAM_BOT_TOKEN, TELEGRAM_GROUP_ID } from "@/lib/telegram";
import { internosEmBaseDesativada, mensagemVoltaParaCasa } from "@/lib/volta-para-casa";
import { localDateStr } from "@/lib/utils";

/** Bot das 09:00: só fala se houver interno em base desativada no diurno. */
export async function sendVoltaParaCasa(options: { dryRun?: boolean } = {}) {
  const date = localDateStr();
  const { bases } = await basesDoTurno(date, "DAY");
  const grupos = internosEmBaseDesativada(
    bases.map((b) => ({
      code: b.code,
      name: b.name,
      desativada: b.desativada,
      ocupantes: b.ocupantes.map((o) => ({ interno: o.interno, faculdade: o.faculdade, status: o.status })),
    })),
  );
  const total = grupos.reduce((n, g) => n + g.internos.length, 0);
  if (grupos.length === 0) return { sent: false, total: 0, preview: null };

  const message = mensagemVoltaParaCasa(grupos, date);
  const dryRun = options.dryRun ?? false;
  if (!dryRun) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_GROUP_ID) throw new Error("Telegram não configurado");
    await bot.api.sendMessage(TELEGRAM_GROUP_ID, message, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  }
  await logAudit({
    action: "TELEGRAM_VOLTA_PARA_CASA",
    entity: "assignment",
    payload: { date, total, bases: grupos.map((g) => g.baseCode), dryRun },
  });
  return { sent: !dryRun, total, preview: message };
}
