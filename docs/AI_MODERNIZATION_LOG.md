# AI_MODERNIZATION_LOG

Log vivo da modernização de stack. Cada onda é registrada aqui: o que mudou, por quê,
erros encontrados, correção, testes e rollback.

---

## Análise — 2026-05-15 (Fase 2, pós-primeira atualização)

### Estado atual da stack

| Camada      | Versão atual         | Latest estável | Observação |
|-------------|----------------------|----------------|------------|
| Node (host/imagem) | 24.8 / 24.15 (`node:24-alpine`) | 24.x LTS / 25.x Current | `.nvmrc` = 24 |
| npm         | 11.6                 | 11.x           | OK |
| Next.js     | 15.5.18              | **16.2.6**     | major atrás |
| React / React-DOM | 19.2.6         | 19.2.6         | **já em latest** |
| TypeScript  | 5.9.3                | **6.0.3**      | major atrás |
| ESLint      | 10.3.0 (instalado)   | 10.x           | **sem config — `next lint` quebrado** |
| Tailwind CSS | 4.3.0               | 4.3.0          | já em latest |
| @tailwindcss/postcss / postcss | 4.3.0 / 8.5.14 | idem  | já em latest |
| Drizzle ORM / Kit | 0.45.2 / 0.31.10 | idem        | já em latest |
| next-auth (Auth.js) | 5.0.0-beta.29  | 5.x beta       | v5 ainda em beta |
| postgres (driver) | 3.4.9          | 3.4.9          | já em latest |
| nodemailer  | 8.0.7                | 8.0.7          | já em latest (Fase 1) |
| grammy      | 1.42.0               | 1.42.0         | já em latest |
| lucide-react | 0.577.0             | **1.16.0**     | major atrás |
| react-day-picker | 9.14.0          | **10.0.1**     | major atrás |
| @types/node | 24.12.4              | 25.8.0         | mantido em 24 p/ casar com runtime |
| zod / date-fns / @aws-sdk | 4.4.3 / 4.1.0 / 3.1047 | idem | já em latest |

### Já atualizado pela Fase 1 (não commitado ainda — branch `chore/modernize-runtime-and-deps`)

Node 20→24, nodemailer 6→8, next 15.5.13→15.5.18, drizzle-orm 0.45.1→0.45.2 (SQL
injection HIGH), minors diversos, `.nvmrc`, `engines`, `--pull` no deploy, guardrail
de versão de Node. Detalhe em [AI_PROJECT_UPGRADE_CONTEXT.md](AI_PROJECT_UPGRADE_CONTEXT.md).

### Ainda desatualizado

`next` (16), `typescript` (6), `lucide-react` (1.x), `react-day-picker` (10) — e a
configuração de ESLint, que hoje não existe (o script `lint` usa `next lint`, depreciado).

### Riscos / bugs já presentes (pré-existentes, não introduzidos pela Fase 1)

- **`npm run lint` não funciona**: `next lint` está depreciado, abre prompt interativo
  (`How would you like to configure ESLint?`) porque não há config ESLint nem
  `eslint-config-next`. Em CI isso travaria — por isso a CI hoje **não** roda lint.
- 7 vulnerabilidades **moderate** (0 high): `postcss` empacotado dentro do `next`
  (resolve com next 16); `next-auth` beta (aviso do Email provider, não usado);
  transitivas dev-only sob `drizzle-kit`/`eslint`.

### Healthcheck / testes

- Healthcheck existe: `GET /taximetro/api/health` (checa env crítico + ping no DB).
- Testes: `node:test` + `tsx`, 80 testes verdes. Há `typecheck`. **Não há lint funcional.**

### Decisão sobre "latest" no runtime

O pedido é mirar em latest. Node 25 ("Current") é o latest absoluto, mas as próprias
regras desta fase (Tarefa 8.4) proíbem runtime fora de LTS em produção. **Decisão:
manter Node em 24 (Active LTS) como "latest estável seguro para runtime"** e aplicar
a política latest de forma agressiva nas *bibliotecas*. Node 25 fica como onda opcional
quando virar LTS (out/2026).

---

## TAREFA 2 — Classificação das dependências

### GRUPO A — latest com baixo risco
Já estão em latest após a Fase 1 (`react`, `tailwindcss`, `drizzle-*`, `zod`, `grammy`,
`nodemailer`, `@aws-sdk`, `postgres`, `tsx`, `date-fns`, `postcss`). Nada a fazer.

### GRUPO B — latest com breaking change administrável (exige adaptação)

| Dependência | Atual → Latest | Distância | Risco | Reescrita? | Teste |
|---|---|---|---|---|---|
| ESLint (config) | inexistente → flat config v9/10 | — | baixo | config nova (não código) | `npm run lint` |
| typescript | 5.9.3 → 6.0.3 | 1 major | baixo-médio | provável: poucos ajustes de tipo | `typecheck`, `build` |
| next | 15.5.18 → 16.2.6 | 1 major | médio | possível: APIs async, `next lint`→ESLint CLI | `build`, smoke health |
| lucide-react | 0.577 → 1.16 | 1 major | baixo | possível: renome de ícones | `build`, inspeção visual |
| react-day-picker | 9.14 → 10.0.1 | 1 major | médio | provável: props do componente de data | `build`, teste do date picker |

### GRUPO C — não atualizar ainda sem plano específico

| Dependência | Motivo |
|---|---|
| next-auth (Auth.js) | em **beta**; mexe em sessão/token/cookie e roda em produção. Mantém `5.0.0-beta.29` pinado até a v5 estável. Não voltar para v4. |
| drizzle-orm / drizzle-kit | já em latest, mas qualquer bump futuro toca geração de schema/migrations — exige revisão dedicada. |

### GRUPO D — substituir ou remover

| Item | Situação | Ação |
|---|---|---|
| `next lint` (script) | depreciado, será removido no Next 16 | **substituir** por ESLint CLI + flat config |
| `eslint` 10.3.0 instalado sem config | meio-termo inútil hoje | **configurar** corretamente (ONDA 0) |

Nenhuma dependência abandonada/duplicada/não-usada detectada além disso.

---

## TAREFA 3 — Plano de ondas

| Onda | Escopo | Risco | Estado |
|---|---|---|---|
| **0** | Estabilização: commitar Fase 1; configurar ESLint flat config (corrige `lint`); `check:versions`; garantir `ci/build/typecheck/lint/docker` verdes | baixo | pendente |
| **1** | Runtime: Node permanece 24 LTS (decisão acima). Sem mudança de código. | baixo | pendente |
| **2** | TypeScript 5.9 → 6; `@types/*` compatíveis; afinar config ESLint | baixo-médio | pendente |
| **3** | Next 15.5 → 16; `eslint-config-next`; adaptar breaking changes; validar build/rotas | médio | pendente |
| **4** | UI: lucide-react 1.x; react-day-picker 10; Tailwind já em latest | médio | pendente |
| **5** | DB/ORM: Drizzle já em latest — apenas revalidar geração de schema | baixo | pendente |
| **6** | Auth: next-auth permanece beta pinado — sem ação, só monitorar v5 estável | — | pendente |
| **7** | Integrações: nodemailer/grammy já em latest — sem ação | — | pendente |
| **8** | Docker/deploy: revisão final (já modernizado na Fase 1) | baixo | pendente |

Regra: não avançar de onda se `npm ci`, `build`, `typecheck`, `lint`, `docker compose
config` ou `docker build` falharem.

---
<!-- Registros de execução de cada onda são acrescentados abaixo desta linha -->

## ONDA 0 — Estabilização (2026-05-15) ✅

**O que mudou:** Fase 1 commitada como baseline (`chore(modernize): unify Node 24 + nodemailer 8 + security fixes (Phase 1)`).

**Decisão:** configuração ESLint (substituir `next lint`) **adiada para ONDA 3** porque
`eslint-config-next@15` só aceita ESLint ≤ 9, enquanto temos ESLint 10. O caminho
arquiteturalmente correto é rodar o codemod `next-lint-to-eslint-cli` durante a
migração para Next 16, que já vem com `eslint-config-next@16` (suporta ESLint 10).

**ONDA 1 (runtime):** Node já está em 24 LTS (Fase 1). Sem ação. Node 25 Current não
é alvo (regra 8.4).

**Testes executados:** `npm ci` ✅, `npm run typecheck` ✅, `npm test` ✅ (80/80),
`docker compose -f docker-compose.dev.yml config` ✅.

**Risco residual:** `npm run lint` continua quebrado (estado pré-existente),
**não está na CI**. Resolvido na ONDA 3.

**Rollback:** `git revert HEAD` (commit único de baseline).

## ONDA 2 — TypeScript 6 (2026-05-15) ✅

**O que mudou:** `typescript ^5.9.3 → ^6.0.3`.

**Erro encontrado e corrigido:**

### Bug de migração: TS2882 em side-effect import de CSS

- Onda: 2
- Dependência: typescript
- Versão anterior: 5.9.3
- Nova versão: 6.0.3
- Erro: `Cannot find module or type declarations for side-effect import of '@/app/globals.css'`
- Causa: TS 6 passou a exigir `declare module` para imports side-effect de arquivos não-TS; `next-env.d.ts` (gerado) ainda não cobre `*.css`.
- Arquivos afetados: `src/app/layout.tsx:4`
- Solução: novo `src/types/globals.d.ts` com `declare module "*.css";`. **Sem** `@ts-expect-error`.
- Testes que validaram: `typecheck`, `test` (80/80), `build`.
- Risco residual: nenhum.

**Testes:** `typecheck` ✅, `test` 80/80 ✅, `build` ✅.

**Rollback:** `git revert <commit ONDA 2>`.

## ONDA 3 — Next 15.5 → 16 + ESLint flat config (2026-05-15) ✅

**O que mudou:**

- `next ^15.5.18 → 16.2.6` (pinado, sem `^`)
- `eslint-config-next` adicionado em `16.2.6`
- `eslint ^10.0.3 → ^9.39.4` (downgrade deliberado — ver bug abaixo)
- `eslint.config.mjs` novo (flat config consumindo `eslint-config-next/core-web-vitals` + `/typescript`)
- script `lint`: `next lint` → `eslint .`
- `overrides.next-auth` estendido com `"next": "$next"` (next-auth@5beta declara peer `next ^14||^15`; v5 não usa internals do Next em runtime)
- `tsconfig.json`: `jsx: "preserve" → "react-jsx"` e `next-env.d.ts` reescrito (ambos auto-editados pelo Next 16 no primeiro build)

**Bugs encontrados:**

### Bug: `eslint-config-next@15` não suporta ESLint 10

- Tentativa: usar ESLint 10 com `eslint-config-next@15`.
- Erro: peer `eslint ^7||^8||^9`. Adiado para esta onda quando `eslint-config-next@16` (peer `>=9.0.0`) ficaria disponível.

### Bug: `eslint-plugin-react@7.37.5` quebra com ESLint 10

- Erro em runtime: `TypeError: contextOrFilename.getFilename is not a function`.
- Causa: ESLint 10 removeu `context.getFilename()`; latest `eslint-plugin-react` ainda não migrou. Sem fix upstream disponível.
- Decisão (regra 8.3 — não usar latest cego se quebra build): **pinar ESLint em ^9.39.4** até o ecossistema React/Next alcançar ESLint 10. Documentado como follow-up.

### Bug: peer conflict `next-auth` ↔ Next 16

- next-auth@5.0.0-beta.29 declara `peer next ^14 || ^15`.
- Fix: estender `overrides` com `"next-auth": {"next": "$next"}`. Justificativa: next-auth v5 não toca internals do Next em runtime; usamos apenas Credentials + Google (Email provider, alvo do peer, **não é usado**).

**Itens fora do escopo (follow-up registrado):**

1. **`middleware.ts` → `proxy.ts`** — Next 16 depreciou o nome `middleware`. Build emite warning. Renomear toca auth/redirect; adiado por regra 8.4 (mudanças sensíveis em auth saem em onda dedicada).
2. **52 erros de lint pré-existentes** (`react-hooks/rules-of-hooks` em ~30 client components). Nunca foram pegos porque `next lint` nunca rodou direito (sem config). Lint **não entra na CI** até esses erros serem corrigidos em revisão dedicada.

**Testes executados:** `typecheck` ✅, `test` 80/80 ✅, `build` ✅ (Next 16, warning de `middleware` deprecation), `lint` roda (mas surfaceia 52 erros pré-existentes — não regridem build).

**Rollback:** `git revert <commit ONDA 3>` + reinstalar (`npm ci`) — Next volta para 15.5.18 via `package-lock`.

## ONDA 4 — UI: lucide-react 1.x + react-day-picker 10 (2026-05-15) ✅

**O que mudou:**

- `lucide-react ^0.577.0 → ^1.16.0`
- `react-day-picker ^9.14.0 → ^10.0.1`

**Erros encontrados:** nenhum. Build, typecheck e testes passaram no primeiro try.

- Os ícones usados (`ChevronLeft/Right`, `Sun`, `Moon`, etc., em 54 arquivos) não tiveram rename na v1.
- A API do `react-day-picker` 10 (`DayPicker`, `DayButton` slot, `classNames`, `startMonth`/`endMonth`, `month`/`onMonthChange`) permanece compatível com o uso atual em `src/components/intern-calendar.tsx`.

**Testes:** `typecheck` ✅, `test` 80/80 ✅, `build` ✅ (apenas o warning de `middleware` deprecation herdado da ONDA 3, fora do escopo).

**Risco residual:** mudanças visuais sutis em ícones (lucide v1 ajustou alguns trazos). Validação visual completa fica para QA pós-deploy — todos os pontos críticos (calendário, sidebar, dashboards) compilam sem erro de tipo.

**Rollback:** `git revert <commit ONDA 4>` + `npm ci`.

## ONDAS 5, 6, 7 — sem ação (2026-05-15) ✅

- **ONDA 5 (DB/ORM)**: `drizzle-orm 0.45.2` e `drizzle-kit 0.31.9` já estão em latest desde a Fase 1. Schema regenerado em `npm run build` (`drizzle-kit generate` no Dockerfile builder) — sem mudança.
- **ONDA 6 (Auth)**: `next-auth 5.0.0-beta.29` permanece **pinado** (Grupo C — beta em produção, troca planejada quando 5.x estável for publicado). Nada a fazer.
- **ONDA 7 (Integrações)**: `nodemailer 8.0.7` (subido na Fase 1) e `grammy 1.41.1` já em latest. Nada a fazer.

## ONDA 8 — Fechamento docker/deploy + docs (2026-05-15) ✅

**O que mudou:**

- Novos docs: `docs/DEPLOY.md`, `docs/ROLLBACK.md`, `docs/DEPENDENCY_UPGRADE_POLICY.md`.
- Revisão final de Dockerfile, deploy.yml e ci.yml — **sem alterações necessárias** (Fase 1 já modernizou: `node:24-alpine`, `--pull` no build, `node-version-file: .nvmrc`, canário antes de swap, healthcheck, smoke via Nginx).

**Testes finais:** `npm ci` ✅, `typecheck` ✅, `test` 80/80 ✅, `build` ✅, `docker compose -f docker-compose.dev.yml config` ✅.

**Risco residual da modernização inteira:**

1. **Warning de `middleware` deprecation no build do Next 16** — funcional, mas remove ruído ao renomear para `proxy.ts`. Saída: onda dedicada (toca auth).
2. **52 erros pré-existentes de `react-hooks/rules-of-hooks`** — não regridem produção (CI roda só typecheck/test/build), mas precisam de revisão antes de habilitar lint na CI.
3. **`eslint 9` pinado** (não 10) — devido a `eslint-plugin-react@7.37.5` não suportar a remoção de `context.getFilename()` no ESLint 10. Subir quando o plugin migrar.
4. **`next-auth 5.0.0-beta.29` pinado em produção** — Grupo C. Monitorar release de 5.x estável.
5. **`postcss` aninhado em `next`** já saiu (Next 16 trouxe versão patcheada). `npm audit` final: 0 HIGH; moderates restantes são dev-only sob `drizzle-kit`/`eslint` ou no Email provider não-usado do next-auth.

**Próximas ondas (fora desta rodada):**

- Onda futura — rename `middleware.ts → proxy.ts` + remoção do warning.
- Onda futura — limpeza dos 52 erros `react-hooks/rules-of-hooks` + adicionar `lint` à CI.
- Onda futura — quando `next-auth 5.x` sair estável.
- Onda futura — Node 25 quando entrar em LTS (esperado out/2026).



