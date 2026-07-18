# Instância VITALMED — Runtime Truth

Segunda instância do Taxímetro Digital para a empresa **Vitalmed**, com banco
**completamente isolado** do cliente original. Mesmo código, mesmo host Magalu,
processos separados. Se houver divergência entre docs antigas e este arquivo,
este arquivo prevalece **para a instância Vitalmed** (a instância original segue
[runtime-truth.md](runtime-truth.md)).

## Topologia

| Item | Original (SAMU/mnrs) | Vitalmed |
|------|----------------------|----------|
| URL pública | `mnrs.com.br/taximetro` | `vitalmed.mnrs.com.br/taximetro` |
| Roteamento Nginx | bloco `server mnrs.com.br` em `estaticos.conf` | mapa `$app_port` em `mnrs.conf` (`vitalmed.mnrs.com.br` → `3010`) |
| Container | `taximetro-digital` (porta 3000) | `vitalmed-digital` (porta **3010**, `--network host`, `HOSTNAME=127.0.0.1`) |
| Imagem | `taximetro-digital:candidate` (GHA) | `vitalmed-digital:mvp` (build manual do branch) |
| Banco | PG 16 nativo `127.0.0.1:5432`, db `taximetro` | PG 16 nativo `127.0.0.1:5432`, db **`vitalmed`**, role **`vitalmed`** |
| AUTH_URL | `https://mnrs.com.br` | `https://vitalmed.mnrs.com.br` |
| AUTH_SECRET | GitHub Secrets | próprio (gerado no provisionamento, guardado no `.env` de referência do host) |
| Backup diário | `/var/backups/taximetro`, e-mail 03:37 | `/var/backups/vitalmed` (`DB_BACKUP_DIR`), **22:00** (`DB_BACKUP_CRON="0 22 * * *"`): e-mail + dump e relatórios de presenças **em PDF no privado do admin** (`TELEGRAM_ADMIN_CHAT_ID`, chromium headless via build arg `INSTALL_CHROMIUM=1`) |
| Telegram | bot ativo (@? SAMU) | bot **@VitalmedCheckin_bot** (`TELEGRAM_BOT_TOKEN_NEXT` no `.env.vitalmed`), webhook `https://vitalmed.mnrs.com.br/taximetro/api/telegram/webhook`; QR do check-in usa `NEXT_PUBLIC_TELEGRAM_GROUP_LINK` (build arg); dica de cadastro do preceptor suprimida via `TELEGRAM_PRECEPTOR_REGISTRATION_URL=off` até existir link de convite Vitalmed |
| Login Google | ativo | indisponível até adicionar o redirect URI no Google Console (ver abaixo) |

O `basePath` continua `/taximetro` também na Vitalmed — ele está acoplado em ~70
arquivos (risco nº 1 do AGENTS.md) e a separação é feita por **hostname**, não
por path. Cloudflare: registro DNS `A vitalmed → 201.23.89.0` (proxy ON); o
cert de origem já cobre `*.mnrs.com.br`.

## Mapeamento de domínio (grade Vitalmed → modelo do app)

- **Viaturas** USA 101/121/131/151/181/191, VLA 321/341/351/361, VRR 551/552/553
  e VLP 221 → `bases` com `type: "USA"` (grade de viaturas, sorteio, 1 interno
  por turno via `slot_rules.capacity = 1`).
- **CCO (Central de Operações, Empire Center)** → base `CCO1` com
  `type: "CENTRAL"`: herda o comportamento de regulação (troca exige
  autorização de preceptor, grade própria em `/admin/escalas/cru`).
- **Meta "CCO só 1x nas 6 semanas"** → `faculties.targetCRUsTotal = 1`
  (acompanhada no cockpit/compliance; não é trava dura de alocação).
- **Faculdades**: UNIFACS (6 semanas × 12h/semana → 72h, 6 plantões) e EBMSP
  (metas iniciais iguais; ajustar em Admin → Faculdades quando a carga real for
  confirmada). Duração real de cada rotação vem das turmas (`cohorts`).
- **Horário por viatura** (06–18h, 07–19h, …): o schema não tem horário por
  base (janela operacional é global DAY/NIGHT em `src/lib/utils.ts`). O horário
  está registrado no `name` da base, só informativo no MVP.
- **Coordenadas dos postos** (Iguatemi, CBX, Arena, Catussaba, Empire Center)
  são aproximadas (`geoFenceMeters = 400`); ajustar no admin antes de cobrar
  check-in por geofence.

Seed: [src/db/seed-vitalmed.ts](../src/db/seed-vitalmed.ts) (`npm run
db:seed-vitalmed`). Idempotente (`onConflictDoNothing`). Exige `DATABASE_URL`
explícito (sem fallback). Env vars: `SEED_ADMIN_PASSWORD` (default `admin123`)
e `SEED_ADMIN_FORCE_CHANGE=1` (força troca de senha no primeiro login — usar em
prod).

## Relatório de presenças (PDF via Telegram)

- Geração compartilhada em `scripts/attendance-report-lib.mjs` (HTML por faculdade:
  internos em ordem alfabética, meta de plantões/regulação, check-in/checkout,
  ausências) + conversão PDF com chromium headless (fallback: envia HTML).
- **Backup diário 22h** (`daily-db-backup.mjs`): além do e-mail, envia dump +
  PDFs ao `TELEGRAM_ADMIN_CHAT_ID`; falha de qualquer perna alerta grupo + admin.
- **Sob demanda**: comando `/relatorio` no privado do bot (exige vínculo
  coordenação/liderança/preceptoria) — dispara `scripts/telegram-send-attendance-report.mjs`.

## Limitações conhecidas do MVP

1. **"CRU fixo" do líder** (`src/lib/cru-fixed.ts`) procura base com
   `code = "CRU"` e lança erro se não existir — na Vitalmed o code é `CCO1`,
   então essa ferramenta específica não funciona (não afeta o restante).
2. **Conflito ±12h por código** (`src/lib/slots.ts` filtra `["CRU","CRL"]`) não
   pega o `CCO1` no caminho por código; o caminho por `type === "CENTRAL"` no
   motor de alocação continua valendo.
3. **`BASE_PRIORITY` do sorteio** (`run-leader-lottery.ts`) lista códigos do
   cliente original; as viaturas Vitalmed caem na prioridade padrão (999) —
   sorteio funciona, apenas sem ordem preferencial de preenchimento.
4. **Branding**: app segue como "Taxímetro Digital" (título, e-mails).
5. **Login Google**: exige adicionar
   `https://vitalmed.mnrs.com.br/taximetro/api/auth/callback/google` nos
   redirect URIs do client OAuth no Google Console. Até lá, login por e-mail/senha.

## Deploy manual (fluxo oficial da Vitalmed no MVP)

O GHA (`deploy.yml`) só cuida da instância original. Vitalmed:

```bash
# 1. Código no host (~/vitalmed-digital) e build
#    (build args de branding: vazio = SAMU; ver src/lib/branding.ts)
ssh magalu 'cd ~/vitalmed-digital && git fetch && git checkout <ref> && \
  docker build -t vitalmed-digital:mvp \
    --build-arg NEXT_PUBLIC_ORG_NAME="Vitalmed" \
    --build-arg NEXT_PUBLIC_ORG_NAME_SHORT="Vitalmed" \
    --build-arg NEXT_PUBLIC_ORG_OG_IMAGE="vitalmed" \
    --build-arg NEXT_PUBLIC_ORG_BASE_URL="https://vitalmed.mnrs.com.br" \
    --build-arg NEXT_PUBLIC_TELEGRAM_GROUP_LINK="https://t.me/+AMX6JIqps6o3YmUx" \
    --build-arg INSTALL_CHROMIUM=1 .'

# 2. Migrations/seed — rodar do notebook via túnel SSH (PG só escuta em loopback)
ssh -fN -L 15432:127.0.0.1:5432 magalu
DATABASE_URL=postgresql://vitalmed:<senha>@localhost:15432/vitalmed npx drizzle-kit push --force
# materialized view: scripts/materialized-view-available-slots.sql via psql

# 3. Recriar container (env de referência em ~/vitalmed-digital/.env.vitalmed no host)
ssh magalu 'docker rm -f vitalmed-digital; docker run -d --name vitalmed-digital \
  --restart unless-stopped --network host --env-file ~/vitalmed-digital/.env.vitalmed \
  -v /var/backups/vitalmed:/var/backups/vitalmed vitalmed-digital:mvp'

# 4. Validação objetiva
ssh magalu 'curl -s http://127.0.0.1:3010/taximetro/api/health'   # "healthy"
curl -sk -o /dev/null -w "%{http_code}" --resolve vitalmed.mnrs.com.br:443:201.23.89.0 \
  https://vitalmed.mnrs.com.br/taximetro/login                     # 200
```

> Diferente da instância original (env só via GHA secrets), a Vitalmed usa
> `--env-file` apontando para `~/vitalmed-digital/.env.vitalmed` no host — esse
> arquivo É a fonte de verdade de env da Vitalmed. Não commitar.
