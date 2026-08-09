/**
 * Quem está montando a escala — e, por consequência, de onde sai a faculdade.
 *
 * A tela de montar escala (CRU fixo semanal + sorteio de intervenção) nasceu do
 * líder, que tem faculdade no vínculo: o servidor lê `actor.facultyId` e nada
 * precisa ser dito. O coordenador não é vinculado a nenhuma faculdade, então
 * para ele a faculdade é escolha de tela e viaja na requisição.
 *
 * As duas diferenças ficam aqui, e não espalhadas por 16 chamadas de fetch:
 * 1. as rotas próprias da tela têm base diferente (`/api/leader` × `/api/admin/escala`)
 * 2. no modo admin, `facultyId` entra na query ou no corpo — no modo líder, nunca.
 *
 * O ponto 2 é o que segura o buraco: se o líder pudesse mandar `facultyId`, ele
 * montaria a escala de outra faculdade. Por isso o acréscimo é decidido aqui
 * pelo escopo, não caso a caso — e o servidor ignora o campo para quem é líder
 * (ver run-leader-lottery.ts e as rotas de /api/admin/escala).
 */

export type EscopoEscala =
  | { tipo: "leader" }
  | { tipo: "admin"; facultyId: string };

/** Sem faculdade explícita é o líder; com faculdade é o coordenador. */
export function escopoDeEscala(facultyId?: string | null): EscopoEscala {
  return facultyId ? { tipo: "admin", facultyId } : { tipo: "leader" };
}

/** Base das rotas exclusivas desta tela (internos, sorteio, CRU fixo). */
export function baseDaEscala(escopo: EscopoEscala): string {
  return escopo.tipo === "admin" ? "/taximetro/api/admin/escala" : "/taximetro/api/leader";
}

/** Acrescenta a faculdade escolhida na query. No líder devolve a URL intacta. */
export function urlComFaculdade(url: string, escopo: EscopoEscala): string {
  if (escopo.tipo === "leader") return url;
  return `${url}${url.includes("?") ? "&" : "?"}facultyId=${encodeURIComponent(escopo.facultyId)}`;
}

/** Acrescenta a faculdade no corpo. No líder devolve o corpo intacto. */
export function corpoComFaculdade<T extends object>(corpo: T, escopo: EscopoEscala): T {
  if (escopo.tipo === "leader") return corpo;
  return { ...corpo, facultyId: escopo.facultyId };
}

/**
 * Cabeçalhos da requisição no escopo dado.
 *
 * No modo admin vai `x-no-impersonate`: o cookie de impersonate sobrevive à
 * navegação (é reposto do sessionStorage a cada carga), e sem esse cabeçalho o
 * servidor resolveria a requisição como o líder visitado por último — a
 * faculdade escolhida na tela seria silenciosamente trocada pela dele.
 */
export function cabecalhosDaEscala(
  escopo: EscopoEscala,
  extras?: Record<string, string>,
): Record<string, string> {
  return escopo.tipo === "admin"
    ? { ...extras, "x-no-impersonate": "1" }
    : { ...extras };
}
