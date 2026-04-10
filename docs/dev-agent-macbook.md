# Dev Local no MacBook (Guia para Agentes e Time)

Objetivo: permitir desenvolvimento local seguro, sem alterar producao, com dados fake para testar features.

## Regras de seguranca (obrigatorias)

- Nunca usar `DATABASE_URL` de producao no ambiente local.
- Nunca executar `db:seed-prod` no MacBook.
- Para testes de features, usar apenas `db:demo` (seed base + seed-dev).
- Deploy para producao so via GitHub Actions em `master`.

## Arquivos de referencia

- Compose dev: [docker-compose.dev.yml](../docker-compose.dev.yml)
- Seed base: [src/db/seed.ts](../src/db/seed.ts)
- Seed fake para features: [src/db/seed-dev.ts](../src/db/seed-dev.ts)

## Quick Start (MacBook)

1. Subir banco local

```bash
docker compose -f docker-compose.dev.yml up -d db
```

2. Rodar schema + seed fake para testes

```bash
docker compose -f docker-compose.dev.yml --profile seed run --rm seed
```

3. Subir app local

```bash
docker compose -f docker-compose.dev.yml up -d app
```

4. Abrir no navegador

- App: http://localhost:3000/taximetro/login

5. Ver logs (quando precisar)

```bash
docker compose -f docker-compose.dev.yml logs -f app
docker compose -f docker-compose.dev.yml logs -f db
```

## Comandos uteis

Recriar seed fake do zero (mantendo o compose):

```bash
docker compose -f docker-compose.dev.yml down
docker volume rm taximetro-digital_taximetro_dev_db_data 2>/dev/null || true
docker compose -f docker-compose.dev.yml up -d db
docker compose -f docker-compose.dev.yml --profile seed run --rm seed
docker compose -f docker-compose.dev.yml up -d app
```

Parar tudo:

```bash
docker compose -f docker-compose.dev.yml down
```

## Checklist para agentes (antes de qualquer mudanca)

- Confirmar que estao usando compose de dev local.
- Confirmar `DATABASE_URL` local apontando para `db:5432` (container local).
- Confirmar que nao existe comando de deploy/seed-prod na execucao.
- Se precisarem dados para feature, rodar `db:demo` (via profile seed).

## Fluxo recomendado de desenvolvimento

1. Desenvolver e testar local no MacBook.
2. Abrir PR para `master`.
3. Validar CI.
4. Merge em `master` para deploy oficial.

Esse fluxo evita alteracoes diretas na instancia de producao durante desenvolvimento de features.
