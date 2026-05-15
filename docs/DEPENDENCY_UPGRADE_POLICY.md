# DEPENDENCY_UPGRADE_POLICY

Regras para subir versões neste repositório.

## TL;DR

1. **Mire em latest estável** para libs.
2. **Nunca runtime fora de LTS** em produção (Node, Postgres, etc).
3. **Não esconda erros** com `any`, `@ts-ignore`, `eslint-disable` ou downgrades automáticos.
4. **Uma onda = um commit**, validado por `npm ci && npm run typecheck && npm test && npm run build`.
5. **Sem merge se canário falhar.**

## Grupos de risco

| Grupo | Critério | Política |
|---|---|---|
| **A** — Latest baixo risco | Patch/minor; já em latest ou bem próximo; lib utilitária madura (ex: `date-fns`, `zod`, `clsx`) | Suba direto, valide com `typecheck + test + build`. |
| **B** — Major administrável | Pulo de 1 major; breaking changes documentadas e localizadas | Onda dedicada. Adapte o código às novas APIs; documente erros e fixes no `AI_MODERNIZATION_LOG.md`. |
| **C** — Não atualizar agora | Beta em produção (`next-auth 5`); lib que toca persistência (`drizzle-orm/drizzle-kit`); lib em transição (`react-day-picker` em RC) | Pin exato. Não voltar para versão anterior. Subir só com plano dedicado. |
| **D** — Substituir / remover | Depreciado (ex: `next lint` no Next 16); duplicado; abandonado | Substituir pela alternativa oficial. |

## Runtime (regra 8.4)

- Use **Active LTS** do Node (atualmente 24). Não use Node Current em produção, mesmo que seja "latest".
- A versão de Node é definida em **um único lugar**: `.nvmrc`. `Dockerfile`, `docker-compose.dev.yml`, `package.json#engines`, `.github/workflows/*` consomem o mesmo valor. O teste `tests/runtime-version.test.ts` impede divergência.

## Como rodar uma onda

1. **Auditoria**: `npm outdated`, `npm audit`, leia changelogs das libs em jogo.
2. **Classifique** o que entra (A/B/C/D) no `AI_MODERNIZATION_LOG.md`.
3. **Branch** dedicada (`chore/modernize-*`).
4. **Suba uma camada por vez** (ex: TS, depois Next, depois UI). Não misture Next 16 + TS 6 + lucide 1 no mesmo commit.
5. **Adapte o código** às novas APIs. Se uma lib bloqueia (ex: `eslint-plugin-react` ainda não suporta ESLint 10), **pin abaixo** com justificativa registrada — não use `any`/ignore para "fazer compilar".
6. **Valide**:
    - `npm ci` (lockfile sincronizado)
    - `npm run typecheck`
    - `npm test`
    - `npm run build`
    - `docker build --pull` (quando tocar runtime)
7. **Commit** com mensagem `chore(modernize): <escopo> (ONDA N)` e atualize `AI_MODERNIZATION_LOG.md`.
8. **PR** com rollback documentado.

## O que não fazer

- ❌ `npm audit fix --force` cego — pode pular major sem revisão.
- ❌ `npm install pkg@latest` em batch.
- ❌ Resolver peer warning de next-auth voltando o `nodemailer` para 6. Use `overrides`.
- ❌ Comitar `package-lock.json` sem ter rodado `npm ci` localmente.
- ❌ Mudar versão de Node sem ajustar todos os 5 pontos (`.nvmrc`, Dockerfile, compose, engines, CI).
- ❌ Esconder erro de tipo com `any` — se a API mudou, adapte; se a tipagem está errada, abra issue upstream e pin abaixo.

## Quando pinar abaixo de latest (e como)

Aceitável se:

- Latest **quebra build** sem fix upstream disponível (ex: `eslint-plugin-react@7.37.5` com ESLint 10).
- Latest é beta/RC instável em rota crítica (ex: `next-auth 5.0.0-beta.29` em produção).
- Há um peer conflict com **outra dep crítica** que ainda não atualizou.

Quando pinar:

1. Pin **exato** (sem `^`), ex: `"eslint": "9.39.4"`.
2. Comentário no `AI_MODERNIZATION_LOG.md` explicando o motivo e a condição para subir (link de issue upstream se houver).
3. Reavaliar no início de cada onda subsequente.

## Vulnerabilidades

- CI roda `npm audit --audit-level=high --omit=dev` — qualquer HIGH em runtime quebra build.
- Moderates são toleradas se forem **dev-only** (transitivas de `drizzle-kit`, `eslint`) ou **provider não usado** (ex: Email provider do next-auth).
- Reavaliar moderates a cada onda. Não acumular.
