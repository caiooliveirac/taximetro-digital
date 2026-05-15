# ROLLBACK

Como reverter um deploy ruim sem perder dados.

## Princípios

- **Imagens antigas continuam no host** (`docker images | grep taximetro`). Rollback é trocar o container ativo pela imagem anterior, não rebuildar nada.
- **Banco de dados nunca é alterado em deploy automático**. Schema só muda via `workflow_dispatch` com `apply_db_changes=true`. Se isso aconteceu, ver seção "Rollback de schema" abaixo.
- O canário do `deploy.yml` impede que imagens quebradas substituam produção, então o cenário mais comum é "deploy passou mas algo regrediu em uso real".

## Rollback rápido (imagem anterior)

Na VM de produção:

```bash
# 1. Listar imagens disponíveis (mais recente primeiro)
docker images taximetro-digital --format "table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}"

# 2. Identificar a imagem anterior (não :candidate; geralmente uma com ID diferente da atual)
docker inspect taximetro-digital --format '{{.Image}}'   # ID da imagem em produção agora
docker images --format "{{.ID}} {{.CreatedSince}}" | head -10

# 3. Trocar para a imagem anterior
PREV_IMAGE="<image-id-anterior>"
docker rm -f taximetro-digital
docker run -d \
  --name taximetro-digital \
  --restart unless-stopped \
  --network repo_default \
  -p 127.0.0.1:3010:3000 \
  -v /var/backups/taximetro:/var/backups/taximetro \
  --add-host=host.docker.internal:host-gateway \
  --env-file /home/ubuntu/taximetro-digital/.env.production \
  "$PREV_IMAGE"

# 4. Validar
docker exec taximetro-digital wget -q -O- http://127.0.0.1:3000/taximetro/api/health
sudo systemctl reload nginx
curl -sk -o /dev/null -w "%{http_code}\n" "https://127.0.0.1/taximetro/login" -H "Host: mnrs.com.br"
```

> O env file `.env.production` na VM não existe por padrão — as envs vêm dos secrets do workflow. Para rollback manual, ou exportar essas envs no comando `docker run -e ...`, ou disparar o workflow novamente apontando para o commit anterior.

## Rollback via re-deploy do commit anterior

Mais simples e auditado:

```bash
git revert <commit-do-deploy-ruim>
git push origin master
```

Ou, se a branch base for outra:

```bash
gh workflow run Deploy --ref <sha-anterior-saudavel>
```

## Rollback de código (não-deploy)

Quando uma onda de modernização precisa ser desfeita antes de ir pra master:

```bash
git checkout chore/modernize-runtime-and-deps
git revert <commit-da-onda>
npm ci   # ressincroniza o lockfile
npm run typecheck && npm test && npm run build
```

## Rollback de schema (caso `apply_db_changes` tenha rodado)

Drizzle não tem `down` automático. Procedimento:

1. **Pare imediatamente** novos deploys (`Settings → Actions → disable workflows`).
2. Restaurar dump mais recente:
    ```bash
    ls -lh /var/backups/taximetro/        # backups diários
    psql "$DATABASE_URL" < /var/backups/taximetro/<dump>.sql
    ```
3. Faça `git revert` do PR de schema e do PR de código que dependia dele.
4. Re-aplique o schema antigo via `workflow_dispatch` (com a versão correta de migrations no source).

## Rollback de runtime (Node major)

Se uma onda de Node falhar em produção (improvável — Fase 1 unificou Node 24 com Docker e CI):

```bash
# Reverter o commit que mudou .nvmrc + Dockerfile
git revert <commit>
git push origin master   # workflow reconstrói com Node anterior
```

O teste `tests/runtime-version.test.ts` garante consistência entre `.nvmrc`, Dockerfile, compose e CI — não é possível subir um deploy onde esses divergem.
