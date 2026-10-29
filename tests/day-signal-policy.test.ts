import test from "node:test";
import assert from "node:assert/strict";
import {
  colisoesComOutroServico,
  motivoParaRecusarSinal,
  type SinalMarcado,
} from "../src/shared/domain/policies/day-signal-policy";

const sn = { id: "sn", date: "2026-11-11", period: "NIGHT" as const, baseCode: "PP20", baseName: "Base Periperi" };
const outroManha: SinalMarcado = { date: "2026-11-12", period: "DAY", signal: "OUTRO_SERVICO", label: "UPA" };

test("outro serviço colado no fim de uma noite do SAMU é colisão", () => {
  const c = colisoesComOutroServico([sn], [outroManha]);
  assert.equal(c.get("sn")?.label, "UPA");
});

test("outro serviço no mesmo turno é colisão; dois turnos depois não é", () => {
  const mesmo = colisoesComOutroServico([sn], [{ date: "2026-11-11", period: "NIGHT", signal: "OUTRO_SERVICO" }]);
  assert.ok(mesmo.has("sn"));
  const longe = colisoesComOutroServico([sn], [{ date: "2026-11-12", period: "NIGHT", signal: "OUTRO_SERVICO" }]);
  assert.equal(longe.size, 0);
});

test("Quero e Posso não colidem com nada", () => {
  const c = colisoesComOutroServico([sn], [{ date: "2026-11-12", period: "DAY", signal: "QUERO" }]);
  assert.equal(c.size, 0);
});

test("meio turno do EBMSP só colide no mesmo turno", () => {
  const manha = { id: "m", date: "2026-11-12", period: "DAY" as const, shift: "MORNING", baseCode: "CRU" };
  const vizinho = colisoesComOutroServico([manha], [{ date: "2026-11-11", period: "NIGHT", signal: "OUTRO_SERVICO" }]);
  assert.equal(vizinho.size, 0);
  const mesmo = colisoesComOutroServico([manha], [{ date: "2026-11-12", period: "DAY", signal: "OUTRO_SERVICO" }]);
  assert.ok(mesmo.has("m"));
});

test("Quero recusado no turno do plantão, colado nele ou colado em outro serviço", () => {
  const base = { plantoes: [sn], sinais: [outroManha] };
  assert.match(motivoParaRecusarSinal({ ...base, signal: "QUERO", turno: { date: "2026-11-11", period: "NIGHT" } })!, /já está de plantão em Periperi/);
  assert.match(motivoParaRecusarSinal({ ...base, signal: "POSSO", turno: { date: "2026-11-11", period: "DAY" } })!, /colado no seu plantão de Periperi/);
  assert.match(motivoParaRecusarSinal({ ...base, signal: "QUERO", turno: { date: "2026-11-12", period: "NIGHT" } })!, /colado num outro serviço/);
  assert.match(motivoParaRecusarSinal({ ...base, signal: "QUERO", turno: { date: "2026-11-12", period: "DAY" } })!, /marcado como outro serviço/);
});

test("Quero aceito em turno livre e descansado; outro serviço sempre aceito", () => {
  const base = { plantoes: [sn], sinais: [outroManha] };
  assert.equal(motivoParaRecusarSinal({ ...base, signal: "QUERO", turno: { date: "2026-11-14", period: "DAY" } }), null);
  assert.equal(motivoParaRecusarSinal({ ...base, signal: "OUTRO_SERVICO", turno: { date: "2026-11-11", period: "NIGHT" } }), null);
});
