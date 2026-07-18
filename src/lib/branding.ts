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
