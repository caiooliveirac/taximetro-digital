/**
 * Marcação mínima dos avisos da Dai no chat: `**negrito**` e
 * `[rótulo](/intern/...)`. Link só para tela do próprio app (intern/leader),
 * nunca endereço de fora. Puro, para teste.
 */

export type Parte = { tipo: "texto" | "negrito"; texto: string } | { tipo: "link"; texto: string; href: string };

const LINK_INTERNO = /^\/(intern|leader)(\/[\w\-/]*)?(\?[\w\-=&%.]*)?$/;
const MARCA = /\*\*(.+?)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export function partesDaLinha(linha: string): Parte[] {
  const partes: Parte[] = [];
  let resto = 0;
  for (const m of linha.matchAll(MARCA)) {
    if (m.index! > resto) partes.push({ tipo: "texto", texto: linha.slice(resto, m.index) });
    if (m[1] !== undefined) partes.push({ tipo: "negrito", texto: m[1] });
    else if (LINK_INTERNO.test(m[3])) partes.push({ tipo: "link", texto: m[2], href: m[3] });
    else partes.push({ tipo: "texto", texto: m[0] });
    resto = m.index! + m[0].length;
  }
  if (resto < linha.length) partes.push({ tipo: "texto", texto: linha.slice(resto) });
  return partes;
}

/** O texto sem marcação, para a prévia da lista de conversas. */
export function semMarcacao(texto: string): string {
  return texto.replace(MARCA, (_, negrito, rotulo) => negrito ?? rotulo);
}
