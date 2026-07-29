# Instância VITALMED — Runtime Truth

Segunda instância do Taxímetro Digital para a empresa **Vitalmed**, com banco
**completamente isolado** do cliente original. Mesmo código, mesmo host Magalu,
processos separados. Se houver divergência entre docs antigas e este arquivo,
este arquivo prevalece **para a instância Vitalmed** (a instância original segue
[runtime-truth.md](runtime-truth.md)).

Desde a migração para o `master`, a Vitalmed **não tem mais branch próprio**: o
que a diferencia do SAMU é uma chave só, `NEXT_PUBLIC_ORG=vitalmed`, lida por
[src/lib/instance.ts](../src/lib/instance.ts) e
[src/lib/branding.ts](../src/lib/branding.ts).

## Topologia

| Item | Original (SAMU/mnrs) | Vitalmed |
|------|----------------------|----------|
| URL pública | `mnrs.com.br/taximetro` | `vitalmed.mnrs.com.br/taximetro` |
| Roteamento Nginx | bloco `server mnrs.com.br` em `estaticos.conf` | mapa `$app_port` em `mnrs.conf` (`vitalmed.mnrs.com.br` → `3010`) |
| Container | `taximetro-digital` (porta 3000) | `vitalmed-digital` (porta **3010**, `--network host`) |
| Imagem | `taximetro-digital:candidate` (GHA) | `vitalmed-digital:mvp` (build manual do `master`) |
| Banco | PG 16 nativo `127.0.0.1:5432`, db `taximetro` | PG 16 nativo `127.0.0.1:5432`, db **`vitalmed`**, role **`vitalmed`** |
| AUTH_URL | `https://mnrs.com.br` | `https://vitalmed.mnrs.com.br` |
| AUTH_SECRET | GitHub Secrets | próprio, no `.env.vitalmed` do host |
| Backup diário | `/var/backups/taximetro`, e-mail 03:37 | `/var/backups/vitalmed` (`DB_BACKUP_DIR`), **22:00** (`DB_BACKUP_CRON="0 22 * * *"`): e-mail + dump e relatórios em **PDF no privado do admin** (`TELEGRAM_ADMIN_CHAT_ID`) |
| Telegram | bot ativo (SAMU) | bot **@VitalmedCheckin_bot** (`TELEGRAM_BOT_TOKEN_NEXT` no `.env.vitalmed`), webhook `https://vitalmed.mnrs.com.br/taximetro/api/telegram/webhook` |
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

Seed: [src/db/seed-vitalmed.ts](../src/db/seed-vitalmed.ts)
(`npm run db:seed:vitalmed`). Idempotente (`onConflictDoNothing`). Env vars:
`SEED_ADMIN_PASSWORD` (default `admin123`) e `SEED_ADMIN_FORCE_CHANGE=1` (força
troca de senha no primeiro login — usar em prod).

## Relatório de presenças (PDF via Telegram)

- Geração compartilhada em [scripts/attendance-report-lib.mjs](../scripts/attendance-report-lib.mjs):
  um HTML por faculdade (internos em ordem alfabética, meta de plantões e de
  regulação, plantões com check-in/checkout, ausências) + conversão para PDF com
  chromium headless. **Sem chromium na imagem o relatório continua saindo**, como
  HTML — `htmlToPdf` retorna `null` e quem chama cai no fallback.
- Os nomes que mudam entre instâncias (CRU/USA no SAMU, Regulação/Viaturas na
  Vitalmed) saem da tabela `NOMES_POR_INSTANCIA` no topo da lib, chaveada pela
  mesma `NEXT_PUBLIC_ORG`. O que o relatório **conta** é idêntico nas duas.
- **Backup diário 22h** ([daily-db-backup.mjs](../scripts/daily-db-backup.mjs)):
  além do e-mail, envia dump + PDFs ao `TELEGRAM_ADMIN_CHAT_ID`; falha de
  qualquer perna alerta grupo **e** admin. Sem `TELEGRAM_ADMIN_CHAT_ID` o bloco
  inteiro é no-op e o backup segue só por e-mail.
- **Sob demanda**: `/relatorio` no privado do bot (exige vínculo de
  coordenação/liderança/preceptoria) — o webhook responde na hora e dispara
  [telegram-send-attendance-report.mjs](../scripts/telegram-send-attendance-report.mjs)
  em processo separado, porque gerar os PDFs não cabe no tempo de resposta do
  webhook. No grupo, `/relatorio` recusa e manda pedir no privado: o relatório
  tem dados de todos os internos.

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
4. **Login Google**: exige adicionar
   `https://vitalmed.mnrs.com.br/taximetro/api/auth/callback/google` nos
   redirect URIs do client OAuth no Google Console. Até lá, login por e-mail/senha.
5. **Nada de "Taxímetro Digital" genérico**: nome, ícones, OG e menu já saem da
   instância. Escala USA/CRU aparecem como **APH/CCO** e a Escala CRL não existe
   na Vitalmed — não só escondida do menu, a rota responde 404
   (`exigirEscala` em [src/lib/feature-gate.ts](../src/lib/feature-gate.ts)).

## Deploy (fluxo oficial da Vitalmed)

O GHA (`deploy.yml`) só cuida da instância original. A Vitalmed sobe pelo script
com trava, **a partir do `master`**:

```bash
ssh magalu 'cd ~/vitalmed-digital && ./scripts/deploy-vitalmed.sh'
```

O script recusa deploy se o host tiver alteração não commitada ou commit que não
subiu para o GitHub (foi assim que o commit do ícone da Vitalmed quase se perdeu
em 2026-07-28), faz o build, recria o container e só declara sucesso depois do
health check — com `docker logs` na tela se não responder.

O build é uma chave só mais o opt-in do chromium:

```
--build-arg NEXT_PUBLIC_ORG=vitalmed --build-arg INSTALL_CHROMIUM=1
```

`NEXT_PUBLIC_ORG` entra no build (para o bundle do Next) **e** no runtime da
imagem (para os scripts `.mjs`, que rodam fora do bundler). O build do SAMU não
passa build arg nenhum: vazio resolve para `samu`, o comportamento original.

Migrations e seed rodam do notebook via túnel SSH (o PG só escuta em loopback):

```bash
ssh -fN -L 15432:127.0.0.1:5432 magalu
DATABASE_URL=postgresql://vitalmed:<senha>@localhost:15432/vitalmed npx drizzle-kit push --force
# materialized view: scripts/materialized-view-available-slots.sql via psql
```

Validação objetiva depois de subir:

```bash
ssh magalu 'curl -s http://127.0.0.1:3010/taximetro/api/health'   # "healthy"
curl -sk -o /dev/null -w "%{http_code}" --resolve vitalmed.mnrs.com.br:443:201.23.89.0 \
  https://vitalmed.mnrs.com.br/taximetro/login                     # 200
```

> Diferente da instância original (env só via GHA secrets), a Vitalmed usa
> `--env-file` apontando para `~/vitalmed-digital/.env.vitalmed` no host — esse
> arquivo É a fonte de verdade de env da Vitalmed. Não commitar.
