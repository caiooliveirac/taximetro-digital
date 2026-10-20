/**
 * Aviso do interno para o secretário (app `tom`), que entrega no WhatsApp da
 * coordenação.
 *
 * Três botões na tela do plantão de hoje: sem médico, sem enfermeiro, problema
 * na viatura. É o interno na ponta contando o que vê; a coordenação precisa
 * saber no minuto. O `tom` é quem fala com os números cadastrados — ele já tem
 * a allowlist, o "para" que cala o canal e o log. Mandar daqui direto para o
 * gateway seria um segundo dono da mesma conversa.
 *
 * `avisarSecretario` NUNCA levanta: o registro no `audit_logs` é a verdade,
 * a entrega é cortesia.
 */

export const TIPOS_DE_AVISO = {
  SEM_MEDICO: "sem médico na base",
  SEM_ENFERMEIRO: "sem enfermeiro na base",
  VIATURA: "problema na viatura",
} as const;

export type TipoDeAviso = keyof typeof TIPOS_DE_AVISO;

/** Status em que o interno pode estar fisicamente na base — aviso e remanejamento só valem aí. */
export const STATUS_NA_BASE: ReadonlySet<string> = new Set(["SCHEDULED", "CONFIRMED", "CHECKED_IN"]);

export function textoDoAviso(p: {
  tipo: TipoDeAviso;
  interno: string;
  faculdade: string | null;
  baseCode: string;
  hora: string;
}): string {
  const quem = p.faculdade ? `*${p.interno}* (${p.faculdade})` : `*${p.interno}*`;
  return `🧑‍⚕️ ${quem} na ${p.baseCode} às ${p.hora}: ${TIPOS_DE_AVISO[p.tipo]}.`;
}

const REPETICAO_MS = 30 * 60_000;

/**
 * Toque repetido do mesmo botão, no mesmo plantão e na MESMA base, dentro de
 * 30 min: o dedo tremeu, não a base. Em outra base (o interno foi remanejado) é
 * aviso novo — sem a base na chave, ele era engolido sem registro (STAX-12).
 * Marca o toque em `ultimos` quando ele vale.
 */
export function avisoRepetido(
  ultimos: Map<string, number>,
  p: { assignmentId: string; baseId: string; tipo: string },
  agora: number,
): boolean {
  const chave = `${p.assignmentId}:${p.baseId}:${p.tipo}`;
  if (agora - (ultimos.get(chave) ?? 0) < REPETICAO_MS) return true;
  ultimos.set(chave, agora);
  return false;
}

const TIMEOUT_MS = 5_000;

export async function avisarSecretario(texto: string): Promise<boolean> {
  const url = process.env.TOM_AVISO_URL?.trim();
  if (!url) {
    console.warn("[aviso] TOM_AVISO_URL não configurado; aviso não entregue.");
    return false;
  }
  try {
    const resposta = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.TOM_HOOK_SECRET?.trim() ? { "x-tom-secret": process.env.TOM_HOOK_SECRET.trim() } : {}),
      },
      body: JSON.stringify({ origem: "taximetro", texto }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resposta.ok) console.warn(`[aviso] secretário respondeu ${resposta.status}`);
    return resposta.ok;
  } catch (erro) {
    console.warn(`[aviso] secretário indisponível: ${erro instanceof Error ? erro.message : erro}`);
    return false;
  }
}
