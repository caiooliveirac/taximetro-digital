#!/usr/bin/env bash
#
# deploy-vitalmed.sh — atualiza a instância Vitalmed no host, com trava.
#
# Motivo: em 2026-07-28 descobrimos que o host estava 3 commits à frente do
# GitHub. Um deles — o ícone e o manifest PWA da Vitalmed — existia SÓ ali.
# Bastava alguém apagar o branch ou recriar o servidor e o código sumia do mundo.
#
# A trava é simples: o servidor não é lugar de escrever código, é lugar de
# receber código. Se o que está no host não estiver inteiro no GitHub, este
# script para e mostra o que ficaria para trás — em vez de sobrescrever.
#
# Uso (no host):  ./scripts/deploy-vitalmed.sh
#
set -euo pipefail

DIR_APP="${DIR_APP:-$HOME/vitalmed-digital}"
BRANCH="${BRANCH:-master}"
ENV_FILE="${ENV_FILE:-$DIR_APP/.env.vitalmed}"
IMAGEM="vitalmed-digital:mvp"
CONTAINER="vitalmed-digital"
PORTA="${PORTA:-3010}"
# Precisa bater com DB_BACKUP_DIR do .env.vitalmed. Sem este volume o backup
# diário é gravado dentro do container e some na próxima recriação — sem erro
# nenhum, porque o envio por e-mail e Telegram continua funcionando.
DIR_BACKUP="${DIR_BACKUP:-/var/backups/vitalmed}"

erro() { echo "❌ ABORTADO: $*" >&2; exit 1; }

cd "$DIR_APP" || erro "não achei $DIR_APP"

echo "▶ Conferindo se o host tem código que o GitHub não tem..."
git fetch origin --quiet

# ── Trava 1: nada de alteração solta no servidor ─────────────────
if [ -n "$(git status --porcelain)" ]; then
  echo "" >&2
  git status --short >&2
  echo "" >&2
  erro "há alteração não commitada no servidor.
   Isto é código que existe só aqui. Se o deploy continuar, ele é sobrescrito.
   Commite e faça push, ou descarte de propósito, antes de rodar de novo."
fi

# ── Trava 2: nada de commit que não subiu ────────────────────────
NAO_ENVIADOS=$(git log --oneline "origin/$BRANCH..HEAD" 2>/dev/null || true)
if [ -n "$NAO_ENVIADOS" ]; then
  echo "" >&2
  echo "Commits que existem só neste servidor:" >&2
  echo "$NAO_ENVIADOS" >&2
  echo "" >&2
  erro "o servidor está à frente do GitHub.
   Foi exatamente assim que o commit do ícone da Vitalmed quase se perdeu.
   Rode 'git push origin $BRANCH' antes de continuar."
fi

echo "✓ Host e GitHub estão sincronizados."

# ── Atualiza e sobe ──────────────────────────────────────────────
git checkout "$BRANCH" --quiet
git pull --ff-only origin "$BRANCH"
COMMIT=$(git rev-parse --short HEAD)
echo "▶ Build da imagem em $COMMIT..."

[ -f "$ENV_FILE" ] || erro "não achei o env da instância em $ENV_FILE"

# Uma chave só: NEXT_PUBLIC_ORG. Nome, nome curto, base URL, imagem OG, ícones e
# link do grupo saem todos dela (src/lib/instance.ts + src/lib/branding.ts) — antes
# eram cinco build args soltos que podiam se contradizer entre si.
# INSTALL_CHROMIUM=1 é o que permite gerar o relatório de presenças em PDF.
docker build \
  --build-arg NEXT_PUBLIC_ORG=vitalmed \
  --build-arg INSTALL_CHROMIUM=1 \
  -t "$IMAGEM" .

echo "▶ Recriando o container..."
mkdir -p "$DIR_BACKUP"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --network host \
  --env-file "$ENV_FILE" \
  -e PORT="$PORTA" \
  -v "$DIR_BACKUP:$DIR_BACKUP" \
  "$IMAGEM"

echo "▶ Aguardando responder..."
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORTA/taximetro/api/health" >/dev/null 2>&1; then
    echo "✅ Vitalmed no ar em $COMMIT (porta $PORTA)."
    exit 0
  fi
  sleep 2
done

echo "" >&2
docker logs --tail 40 "$CONTAINER" >&2
erro "subiu mas não respondeu ao health check em 60s. Logs acima."
