/**
 * Temas dos casos do Dai e o reconhecimento do pedido ("quero discutir AVC",
 * "um caso de sepse"). Sem modelo e sem o conteúdo: este arquivo vai para o
 * navegador; os casos ficam em dai-casos.ts, só no servidor.
 *
 * Ordem = o que os internos mais registram em ocorrências (docs/PLAN-dai-casos.md).
 */

export const TEMAS = [
  { tema: "TRAUMA", rotulo: "Trauma", re: /trauma|\btce\b|politrauma|\bmoto\b|queda|atropel|colis|\bfa[fb]\b|ferimento|fratura|pelve|hemorragi\w* (externa|grave)/ },
  { tema: "AVC", rotulo: "AVC", re: /\bav[ce]\b|derrame|deficit|hemipar|afasia/ },
  { tema: "IAM", rotulo: "IAM / dor torácica", re: /\biam\b|infarto|dor (no peito|torac\w*)|\bsca\b|supra|precordial|\becg\b/ },
  { tema: "SEPSE", rotulo: "Sepse", re: /seps\w*|septic\w*/ },
  { tema: "ASMA", rotulo: "Asma", re: /asma\w*|broncoespasm\w*|sibil\w*/ },
  { tema: "DPOC", rotulo: "DPOC", re: /\bdpoc\b/ },
  { tema: "TEP", rotulo: "TEP", re: /\btep\b|embolia/ },
  { tema: "HDA", rotulo: "Hemorragia digestiva", re: /\bhda\b|hemorragia digestiva|hematemese|melena/ },
  { tema: "CHOQUE", rotulo: "Choque", re: /choque|hipotens\w*/ },
  { tema: "ANAFILAXIA", rotulo: "Anafilaxia", re: /anafila\w*|alergi\w*/ },
] as const;

export type Tema = (typeof TEMAS)[number]["tema"];

export const rotuloDoTema = (tema: string) => TEMAS.find((t) => t.tema === tema)?.rotulo ?? tema;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function temaDe(texto: string): Tema | null {
  const q = norm(texto);
  return TEMAS.find((t) => t.re.test(q))?.tema ?? null;
}

/** Verbo de estudo, "um caso", "caso de X" ou só o nome de um tema. */
const PEDIDO = /\b(charadas?|discutir|revisar|estudar|treinar)\b|\b(um|outro|novo|mais um) caso\b|\bcasos? (de|sobre|clinico)\b/;

/**
 * `undefined`: não é pedido de caso (segue para o Dai de plantões).
 * `null`: é pedido de caso, mas sem tema reconhecido (mostra os temas).
 */
export function pedidoDeCaso(texto: string): Tema | null | undefined {
  const q = norm(texto);
  if (!q || q.length > 90) return undefined;
  const tema = temaDe(q);
  if (PEDIDO.test(q)) return tema ?? (/plantao|escala|troca|meta|vaga|extra/.test(q) ? undefined : null);
  return tema && q.split(" ").length <= 3 ? tema : undefined;
}
