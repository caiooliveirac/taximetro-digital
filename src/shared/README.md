# Shared Layer

Componentes transversais ao sistema:
- db/: client e schema compartilhados
- infra/: logger, tempo, validacoes e utilitarios tecnicos
- auth/: componentes de sessao e RBAC (migracao progressiva)

Objetivo: reduzir acoplamento e permitir que features usem dependencias comuns por contratos estaveis.
