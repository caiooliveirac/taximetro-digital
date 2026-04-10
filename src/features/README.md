# Features Layer

Esta pasta recebe a modularizacao progressiva por dominio.

Estrutura alvo por feature:
- application/: casos de uso
- domain/: entidades e regras puras
- infra/: repositorios e gateways externos
- ui/: presenters, hooks e adaptadores visuais

Regras de migracao:
1. Nao mover tudo de uma vez.
2. Manter contratos HTTP existentes enquanto as rotas sao adaptadas.
3. Evitar regra de negocio em page.tsx e route.ts quando ja existir use case da feature.
4. Manter re-exports de compatibilidade nos caminhos legados durante transicao.
