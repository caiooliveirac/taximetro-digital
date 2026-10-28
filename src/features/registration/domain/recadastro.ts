/**
 * Aluno que roda de novo cria conta nova pelo link da turma nova e começa do
 * zero. A conta antiga com o mesmo e-mail ou CPF é arquivada (não apagada):
 * histórico de plantões fica nela, e o e-mail/CPF/Google/Telegram ficam livres
 * para a conta nova.
 *
 * Só arquiva conta de turma já fechada (ou sem turma). Conta de turma em
 * andamento ou planejada colide como antes: a coordenação resolve à mão.
 */

export type ContaExistente = {
  roles: { role: string; cohortStatus: "PLANNED" | "ACTIVE" | "CLOSED" | null; isActive: boolean }[];
  /** Último plantão ainda por cumprir (hoje em diante), YYYY-MM-DD. */
  ultimoPlantaoPendente: string | null;
};

export type DecisaoRecadastro =
  | { tipo: "arquivar" }
  | { tipo: "turma-aberta" }
  | { tipo: "conta-de-equipe" }
  | { tipo: "plantao-pendente"; ate: string };

export function decidirRecadastro(conta: ContaExistente): DecisaoRecadastro {
  // Coordenação e preceptoria não são turma: conta deles não se arquiva por convite.
  if (conta.roles.some((r) => r.isActive && (r.role === "COORDINATOR" || r.role === "PRECEPTOR"))) {
    return { tipo: "conta-de-equipe" };
  }
  // Turma atual, a do próprio link (cadastro repetido ou aguardando aprovação)
  // ou outra ainda aberta: não arquiva.
  if (conta.roles.some((r) => r.cohortStatus !== null && r.cohortStatus !== "CLOSED")) {
    return { tipo: "turma-aberta" };
  }
  // Arquivar agora deixaria plantão marcado sem dono.
  if (conta.ultimoPlantaoPendente) {
    return { tipo: "plantao-pendente", ate: conta.ultimoPlantaoPendente };
  }
  return { tipo: "arquivar" };
}

export function emailDeContaArquivada(userId: string) {
  return `arquivado+${userId}@recadastro.local`;
}
