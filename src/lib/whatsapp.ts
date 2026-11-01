// Link wa.me a partir do telefone como foi cadastrado ("(71) 99999-9999",
// "71999999999", "+55 71 ..."). Sem DDI, assume Brasil. Número que não
// parece telefone devolve null — melhor sem botão do que link quebrado.
export function whatsappLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `https://wa.me/55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return `https://wa.me/${digits}`;
  return null;
}
