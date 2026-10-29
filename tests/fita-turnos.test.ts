import test from "node:test";
import assert from "node:assert/strict";
import { montarFita, segundaDaSemana } from "../src/lib/fita-turnos";

type P = { id: string; date: string; period: "DAY" | "NIGHT"; shift?: string | null };

const dia = (fita: ReturnType<typeof montarFita<P>>, date: string) =>
  fita.flatMap((s) => s.dias).find((d) => d.date === date)!;

test("semana começa na segunda, inclusive quando o plantão cai no domingo", () => {
  assert.equal(segundaDaSemana("2026-11-01"), "2026-10-26"); // domingo
  assert.equal(segundaDaSemana("2026-10-26"), "2026-10-26"); // segunda
  const fita = montarFita<P>([{ id: "a", date: "2026-11-01", period: "DAY" }]);
  assert.equal(fita.length, 1);
  assert.equal(fita[0].inicio, "2026-10-26");
  assert.equal(fita[0].dias[6].date, "2026-11-01");
});

test("noturno fecha o diurno do mesmo dia e o do dia seguinte", () => {
  const sn = { id: "sn", date: "2026-11-17", period: "NIGHT" as const };
  const fita = montarFita<P>([sn]);
  assert.equal(dia(fita, "2026-11-17").dia.descansoDe?.id, "sn");
  assert.equal(dia(fita, "2026-11-18").dia.descansoDe?.id, "sn");
  assert.equal(dia(fita, "2026-11-16").noite.descansoDe, null);
  assert.equal(dia(fita, "2026-11-18").noite.descansoDe, null);
});

test("diurno fecha o noturno da véspera e o do mesmo dia", () => {
  const sd = { id: "sd", date: "2026-11-05", period: "DAY" as const };
  const fita = montarFita<P>([sd]);
  assert.equal(dia(fita, "2026-11-04").noite.descansoDe?.id, "sd");
  assert.equal(dia(fita, "2026-11-05").noite.descansoDe?.id, "sd");
  assert.equal(dia(fita, "2026-11-06").dia.descansoDe, null);
});

test("turno ocupado não vira descanso, e meio turno do EBMSP não fecha vizinho", () => {
  const fita = montarFita<P>([
    { id: "manha", date: "2026-11-10", period: "DAY", shift: "MORNING" },
    { id: "tarde", date: "2026-11-10", period: "DAY", shift: "AFTERNOON" },
    { id: "sn", date: "2026-11-11", period: "NIGHT" },
    { id: "sd", date: "2026-11-12", period: "DAY" },
  ]);
  const d10 = dia(fita, "2026-11-10");
  assert.deepEqual(d10.dia.plantoes.map((p) => p.id), ["manha", "tarde"]);
  assert.equal(d10.noite.descansoDe, null);
  // 11 noite e 12 dia são colados: os dois estão ocupados, nenhum vira descanso
  assert.equal(dia(fita, "2026-11-12").dia.descansoDe, null);
  assert.equal(dia(fita, "2026-11-11").dia.descansoDe?.id, "sn");
});
