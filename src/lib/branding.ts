/**
 * branding.ts — identidade visual e textual de cada instância.
 *
 * Deriva tudo de [ORG](./instance.ts). Antes isto eram quatro variáveis de
 * ambiente soltas (nome, nome curto, base URL, chave da imagem OG) que podiam
 * se contradizer entre si — dava para subir um build com o nome de uma
 * instância e a imagem da outra. Agora a chave é uma só.
 */

import { ORG, type Instancia } from "./instance";

type Branding = {
  /** Nome por extenso, usado em e-mails e títulos. */
  nome: string;
  /** Nome curto, usado na barra lateral. */
  nomeCurto: string;
  /** Origem pública da instância — base dos URLs absolutos de OG (metadataBase). */
  baseUrl: string;
  /** Imagem de compartilhamento. Width/height fixos por imagem, não por path livre. */
  og: { url: string; width: number; height: number };
  /** Ícones do app (PWA, favicon, apple-touch). Arquivos distintos por instância. */
  icones: { i192: string; i512: string };
  /**
   * Grupo do Telegram onde o interno valida o check-in (vira o QR na tela).
   * Fica aqui e não em env porque é link público e identifica a instância —
   * mas aceita override por `NEXT_PUBLIC_TELEGRAM_GROUP_LINK` para o dia em que
   * o grupo for recriado sem precisar de deploy de código.
   */
  telegramGroupLink: string;
};

const BRANDING: Record<Instancia, Branding> = {
  samu: {
    nome: "SAMU 192 Salvador",
    nomeCurto: "SAMU Salvador",
    baseUrl: "https://mnrs.com.br",
    og: { url: "/taximetro/icons/image.png", width: 1024, height: 559 },
    icones: {
      i192: "/taximetro/icons/icon-192.png",
      i512: "/taximetro/icons/icon-512.png",
    },
    telegramGroupLink: "https://t.me/TaximetrosSAMUInternos",
  },
  vitalmed: {
    nome: "Vitalmed",
    nomeCurto: "Vitalmed",
    baseUrl: "https://vitalmed.mnrs.com.br",
    og: { url: "/taximetro/icons/og-vitalmed.png", width: 1024, height: 541 },
    icones: {
      i192: "/taximetro/icons/icon-192-vitalmed.png",
      i512: "/taximetro/icons/icon-512-vitalmed.png",
    },
    telegramGroupLink: "https://t.me/+AMX6JIqps6o3YmUx",
  },
};

const atual = BRANDING[ORG];

export const ORG_NAME = atual.nome;
export const ORG_NAME_SHORT = atual.nomeCurto;
export const ORG_BASE_URL = atual.baseUrl;
export const ORG_OG_IMAGE = atual.og;
export const ORG_ICONS = atual.icones;
export const ORG_TELEGRAM_GROUP_LINK =
  process.env.NEXT_PUBLIC_TELEGRAM_GROUP_LINK || atual.telegramGroupLink;

/** Para teste: branding de uma instância específica, sem depender do build atual. */
export function brandingDe(instancia: Instancia): Branding {
  return BRANDING[instancia];
}
