/**
 * Médico previsto por base num turno, pela escala médica do app Escalas &
 * Trocas (escala.mnrs.com.br): `GET /api/esperados?data=&turno=SD|SN`, a mesma
 * rota que o painel do `plantoes` consome. Vale a escala DINÂMICA (depois das
 * trocas), não o fixo — regra de lá (lib/esperados-mes.ts) — inclusive o mês
 * ainda em rascunho (`rascunho=1`).
 *
 * Cortesia, como o canal do plantoes: sem `ESPERADOS_URL`/`ESPERADOS_TOKEN` ou
 * com o app fora, devolve `consultado: false` e quem chama diz que não sabe.
 * Dia sem NENHUMA base na resposta é dia sem escala publicada, não furo em
 * todas as bases: `diaSemEscala: true`.
 */

export type MedicosPrevistos = { consultado: boolean; diaSemEscala: boolean; porBase: Record<string, string[]> };

const NADA: MedicosPrevistos = { consultado: false, diaSemEscala: false, porBase: {} };
const CACHE_MS = 2 * 60_000;
const cache = new Map<string, { em: number; valor: Promise<MedicosPrevistos> }>();

export function escalaMedicaConfigurada(): boolean {
  return Boolean(process.env.ESPERADOS_URL?.trim() && process.env.ESPERADOS_TOKEN?.trim());
}

async function buscar(date: string, turno: "SD" | "SN"): Promise<MedicosPrevistos> {
  const url = process.env.ESPERADOS_URL?.trim();
  const token = process.env.ESPERADOS_TOKEN?.trim();
  if (!url || !token) return NADA;
  try {
    const u = new URL(url);
    u.searchParams.set("data", date);
    u.searchParams.set("turno", turno);
    // A escala médica do mês fica em rascunho por sigilo no app, mas já está
    // lançada; o Escalas libera para quem pede (o bot do grupo também lê assim).
    u.searchParams.set("rascunho", "1");
    const r = await fetch(u, { headers: { "x-esperados-token": token }, signal: AbortSignal.timeout(4_000) });
    if (!r.ok) {
      console.warn(`[escala-medica] esperados respondeu ${r.status}`);
      return NADA;
    }
    const j = (await r.json()) as { ok?: boolean; intervencao?: Record<string, { nome: string; nomeCurto?: string }[]> };
    if (!j.ok) return NADA;
    const porBase: Record<string, string[]> = {};
    for (const [codigo, lista] of Object.entries(j.intervencao ?? {})) {
      porBase[codigo.replace(/-/g, "").toUpperCase()] = lista.map((p) => p.nomeCurto?.trim() || p.nome);
    }
    return { consultado: true, diaSemEscala: Object.keys(porBase).length === 0, porBase };
  } catch (erro) {
    console.warn(`[escala-medica] leitura falhou: ${erro instanceof Error ? erro.message : erro}`);
    return NADA;
  }
}

export function medicosPrevistos(date: string, period: "DAY" | "NIGHT"): Promise<MedicosPrevistos> {
  const turno = period === "DAY" ? "SD" : "SN";
  const chave = `${date}|${turno}`;
  const atual = cache.get(chave);
  if (atual && Date.now() - atual.em < CACHE_MS) return atual.valor;
  const valor = buscar(date, turno);
  cache.set(chave, { em: Date.now(), valor });
  return valor;
}
