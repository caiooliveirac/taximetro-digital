/**
 * Aluno que roda de novo cria conta nova pelo link da turma nova e começa do
 * zero. A conta antiga com o mesmo e-mail ou CPF é arquivada (não apagada):
 * histórico de plantões fica nela, e o e-mail/CPF/Google/Telegram ficam livres
 * para a conta nova.
 *
 * Só não arquiva quando isso tiraria alguém do ar ou duplicaria o cadastro.
 */

export type ContaExistente = {
  roles: { role: string; cohortId: string | null; isActive: boolean }[];
  /** Último plantão ainda por cumprir (hoje em diante), YYYY-MM-DD. */
  ultimoPlantaoPendente: string | null;
};

export type DecisaoRecadastro =
  | { tipo: "arquivar" }
  | { tipo: "ja-na-turma" }
  | { tipo: "conta-de-equipe" }
  | { tipo: "plantao-pendente"; ate: string };

export function decidirRecadastro(conta: ContaExistente, turmaDoConvite: string | null): DecisaoRecadastro {
  // Coordenação e preceptoria não são turma: conta deles não se arquiva por convite.
  if (conta.roles.some((r) => r.isActive && (r.role === "COORDINATOR" || r.role === "PRECEPTOR"))) {
    return { tipo: "conta-de-equipe" };
  }
  // Já se cadastrou nesta turma (inclusive cadastro ainda aguardando aprovação).
  if (turmaDoConvite && conta.roles.some((r) => r.cohortId === turmaDoConvite)) {
    return { tipo: "ja-na-turma" };
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
