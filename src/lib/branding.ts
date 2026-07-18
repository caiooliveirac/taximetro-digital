/**
 * Identidade da organização exibida na UI e nos e-mails.
 *
 * NEXT_PUBLIC_* é inlined no build do Next — instâncias distintas (ex: Vitalmed,
 * ver docs/vitalmed.md) definem os valores via build args no Docker.
 * Sem env definida (ou vazia), mantém o branding original SAMU Salvador,
 * então o build oficial do GHA continua idêntico.
 */
export const ORG_NAME = process.env.NEXT_PUBLIC_ORG_NAME || "SAMU 192 Salvador";
export const ORG_NAME_SHORT = process.env.NEXT_PUBLIC_ORG_NAME_SHORT || "SAMU Salvador";

/** Origem pública da instância — base dos URLs absolutos de OG (metadataBase). */
export const ORG_BASE_URL = process.env.NEXT_PUBLIC_ORG_BASE_URL || "https://mnrs.com.br";

/**
 * Imagem OG por instância. As imagens ficam versionadas em public/icons/ e a
 * seleção é por chave (não por path livre) para manter width/height corretos.
 */
const OG_IMAGES = {
  samu: { url: "/taximetro/icons/image.png", width: 1024, height: 559 },
  vitalmed: { url: "/taximetro/icons/og-vitalmed.png", width: 1024, height: 541 },
} as const;

const ogKey = process.env.NEXT_PUBLIC_ORG_OG_IMAGE as keyof typeof OG_IMAGES | undefined;
export const ORG_OG_IMAGE = (ogKey && OG_IMAGES[ogKey]) || OG_IMAGES.samu;
