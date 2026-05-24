# Investigação — plantões CRU de Júlia Amado (ZARNS) supostamente deslocados +14 dias

**Data da investigação:** 2026-05-20
**Investigador:** Claude Code (modo read-only sobre prod + dump em DB temporário)
**Aluna alvo:** Júlia Amado Moura · `b31bbeaf-bc07-4e33-9c7b-51bc3221f97e` · ZARNS
**Reclamação original:** plantões CRU em 22/05 e 29/05 aparecem como 05/06 e 12/06 (+14d) após o upgrade

---

## Resumo executivo

- **Causa raiz não é o upgrade.** Os plantões de 22/05 e 29/05 da Júlia continuam no banco com sua data original, apenas com status `CANCELLED`.
- **O que aconteceu:** em **2026-05-06 02:34–02:35 UTC** (= 23:34–23:35 BRT de 05/05), a líder/preceptora **Ana Beatriz Andrade** removeu e re-adicionou o template CRU de sexta (FRI) da Júlia. O fluxo `CRU_FIXED_ADD` **pulou** as 4 datas que já estavam canceladas em vez de reativá-las, materializando só 05/06 e 12/06.
- **O upgrade de 2026-05-15** (modernização ONDAS 1-11 + commit `b41da03` lifecycle de turmas) **não alterou nenhuma data** de assignment. Diff PRE/POS sobre o campo `date`: **0 mudanças**.
- **Bug sistêmico:** mesma assinatura aparece em 18 eventos de `CRU_FIXED_ADD` afetando **13 internas**, **65 datas puladas** no total, **14 ainda no futuro**.
- **Ação recomendada (urgente):** corrigir manualmente as 14 datas futuras (`UPDATE status` de `CANCELLED` para `SCHEDULED` nos assignments listados) e patch no código do `CRU_FIXED_ADD` para reativar canceladas em vez de pular.

---

## Linha do tempo

| Quando (UTC) | Evento |
|---|---|
| **2026-04-19 18:38:41** | Templates CRU semanais materializam 8 plantões futuros da Júlia em "Central de Regulação", inclusive 22/05 e 29/05 |
| **2026-05-06 02:33:51** | Ana Beatriz Andrade faz login Google |
| **2026-05-06 02:33:56** | `CRU_FIXED_GENERATE` (weekStart 2026-05-04) — visita a tela |
| **2026-05-06 02:34:05** | `CRU_FIXED_REMOVE` do template `19dab9cb` (FRI/DAY/Central Reg, Júlia) → `cancelledCount: 4` (08/05, 15/05, 22/05, 29/05 viram `CANCELLED`, note: "CRU fixo semanal removido") |
| **2026-05-06 02:34:15** | Ana Beatriz testa `CRU_FIXED_ADD` para Júlia em TUE/DAY/Central Reg (template `3befe916`) — `weeks: 1`, `skippedCount: 1` (05/05 já estava CANCELLED) |
| **2026-05-06 02:34:50** | `CRU_FIXED_REMOVE` do template TUE — `cancelledCount: 0` |
| **2026-05-06 02:35:30** | `CRU_FIXED_ADD` novamente do template FRI `19dab9cb`, `weeks: 6` → `createdCount: 2` (05/06, 12/06), `skippedCount: 4` (08/05, 15/05, 22/05, 29/05 pulados porque estão CANCELLED) |
| **2026-05-15 ~14:22** | Upgrade modernização (ONDAS 1-11 + lifecycle de turmas) faz cutover do container — **não toca em data alguma de assignment** |
| **2026-05-20 12:09** | Investigação inicia |

Resultado líquido para Júlia: perdeu **4 sextas** (08, 15, 22, 29 de maio) e ganhou **2 sextas novas** (05/06, 12/06). Saldo: −2 plantões.

---

## Tabela de hipóteses

| Hipótese | Status | Evidência | Query |
|---|---|---|---|
| **1. Mutação em lote (UPDATE date)** | ❌ DESCARTADO | Diff PRE/POS no campo `date`: 0 mudanças entre 4895 assignments do dump 2026-05-15 e os 4895 IDs ainda existentes em prod | Fase 2 — CSV diff via `awk` |
| **2. Reinterpretação de timezone na migração** | ❌ ESTRUTURALMENTE IMPOSSÍVEL | `assignments.date` é `date` (sem TZ). Versões PG idênticas (16.13 prod, dump também 16.13). DateStyle ISO MDY estável | Fase 0 — `\d assignments` + `SELECT version()` |
| **3. Bug de criação de novo rodízio que sobrescreveu** | ✅ CONFIRMADO (com nuance) | Audit log mostra `CRU_FIXED_REMOVE` (cancela 4 datas) seguido de `CRU_FIXED_ADD` com `skippedCount: 4` nas mesmas datas. Bug está no `ADD` que pula `CANCELLED` em vez de reativar | Fase 3 — audit_log + Fase 2.2 |
| **4. Adulteração pontual** | ❌ DESCARTADO | A operação é legítima (LEADER da base + audit_log com IP/payload). Não há padrão de adulteração maliciosa | Fase 3 |
| **5. Bug frontend** | ❌ DESCARTADO | Frontend não foi tocado — as datas no banco são realmente 22/05 e 29/05 (CANCELLED) + 05/06 e 12/06 (SCHEDULED). A UI apenas oculta CANCELLED, gerando a percepção de deslocamento | Fase 2.1 — query direta |

---

## Escopo do impacto

| Métrica | Valor |
|---|---|
| Datas CANCELLED puladas pelo bug `CRU_FIXED_ADD` (total histórico) | **65** |
| Internas distintas afetadas | **13** |
| Datas no futuro (≥ 2026-05-21) ainda no estado errado | **14** |
| Eventos `CRU_FIXED_ADD` com a assinatura do bug | **18** |
| Eventos onde a operação foi totalmente inútil (`createdCount: 0`) | **12** |

### Datas futuras perdidas que precisam de cura manual

| Interna | Data | Dia | Período | Quando o bug rolou | Operador |
|---|---|---|---|---|---|
| Tainá Cardoso Santos | 2026-05-22 | FRI | DAY | 2026-04-19 23:40 | Thainá Brasileiro Santos |
| Emanuel Caetano Silva | 2026-05-22 | FRI | DAY | 2026-04-19 18:38 | Thainá Brasileiro Santos |
| **Júlia Amado Moura** | **2026-05-22** | **FRI** | **DAY** | **2026-05-06 02:35** | **Ana Beatriz Andrade** |
| Tainá Cardoso Santos | 2026-05-24 | SUN | DAY | 2026-05-08 13:12 | Ana Beatriz Andrade |
| Allan Victor Viana de Souza | 2026-05-25 | MON | NIGHT | 2026-04-19 20:36 | Thainá Brasileiro Santos |
| Davi Augusto de Souza Franca | 2026-05-26 | TUE | NIGHT | 2026-04-24 17:06 | Leandro Nuñez Rodrigues |
| Ana Beatriz Nunes Barreto Oliveira | 2026-05-26 | TUE | DAY | 2026-04-19 20:19 | Thainá Brasileiro Santos |
| Davi Augusto de Souza Franca | 2026-05-26 | TUE | NIGHT | 2026-04-24 18:49 | Leandro Nuñez Rodrigues |
| Davi Augusto de Souza Franca | 2026-05-26 | TUE | NIGHT | 2026-04-24 18:58 | Caio Oliveira |
| Yago Patrick Lima Medeiros | 2026-05-27 | WED | DAY | 2026-04-19 18:39 | Thainá Brasileiro Santos |
| **Júlia Amado Moura** | **2026-05-29** | **FRI** | **DAY** | **2026-05-06 02:35** | **Ana Beatriz Andrade** |
| Tainá Cardoso Santos | 2026-05-29 | FRI | DAY | 2026-04-19 23:40 | Thainá Brasileiro Santos |
| Emanuel Caetano Silva | 2026-05-29 | FRI | DAY | 2026-04-19 18:38 | Thainá Brasileiro Santos |
| Tainá Cardoso Santos | 2026-05-31 | SUN | DAY | 2026-05-08 13:12 | Ana Beatriz Andrade |

> Observação: três internas (Davi, Júlia, Tainá) levam o bug mais de uma vez no mesmo dia porque operadores diferentes adicionaram/removeram templates sobre datas já canceladas.

---

## Cada query rodada (reproduzível)

> Todas SELECT-only. Nenhuma escrita feita no banco de produção `taximetro`. Banco temporário `taximetro_preupgrade` foi criado **separadamente** no mesmo cluster PG (owner: taximetro) para o sanity check.

### Fase 0 — versões e tipos

```sql
SELECT version();
-- → PostgreSQL 16.13 (Ubuntu 16.13-1.pgdg24.04+1) on aarch64-unknown-linux-gnu

SHOW timezone;   -- Etc/UTC
SHOW datestyle;  -- ISO, MDY

\d assignments
-- coluna date é "date" (NOT NULL), sem TZ
```

Dump pré-upgrade: `/var/backups/taximetro/taximetro-20260515-033700.dump` (custom v1.16, gerado por `pg_dump 18.4` em 2026-05-15 06:37 UTC, ~8h antes do swap das 14:22 UTC).

Container container da app tem `pg_restore 18.4`; o `pg_restore 16.13` do host não lê v1.16. Restore feito via container:

```bash
sudo -u postgres createdb -O taximetro taximetro_preupgrade
docker cp /var/backups/taximetro/taximetro-20260515-033700.dump taximetro-digital:/tmp/pre.dump
docker exec -e PGPASSWORD="…" taximetro-digital pg_restore \
  --no-owner --no-privileges -h host.docker.internal -p 5432 -U taximetro \
  -d taximetro_preupgrade /tmp/pre.dump
# 1 warning ignorável: "transaction_timeout" (param do PG 18 que o PG 16 não conhece)
docker exec taximetro-digital rm /tmp/pre.dump
```

Contagens:
- `taximetro_preupgrade.assignments`: 4895
- `taximetro.assignments`: 4966
- Delta: +71 (novos plantões em 5 dias, esperado)

### Fase 2 — diff cirúrgico

**Diff só do campo `date` (decisivo):**

```sql
-- exportar (id, date) dos dois bancos
\copy (SELECT id, date FROM assignments ORDER BY id) TO '/tmp/pre_dates.csv' CSV  -- em taximetro_preupgrade
\copy (SELECT id, date FROM assignments ORDER BY id) TO '/tmp/pos_dates.csv' CSV  -- em taximetro
```

```bash
awk -F, 'NR==FNR{rec[$1]=$2; next} ($1 in rec) && (rec[$1]!=$2) {print}' \
  /tmp/pre_dates.csv /tmp/pos_dates.csv | wc -l
# 0
```

**Conclusão:** zero assignments tiveram `date` modificado entre o dump pré-upgrade e o estado atual. Hipótese de upgrade alterando datas → matematicamente descartada.

### Fase 2.1 — Júlia Amado no dump pré-upgrade

```sql
SELECT a.id, a.date, a.period, a.status, b.name AS base, a.created_at, a.updated_at, a.notes
FROM assignments a JOIN bases b ON b.id = a.base_id
WHERE a.intern_id = 'b31bbeaf-bc07-4e33-9c7b-51bc3221f97e'
  AND a.date BETWEEN '2026-05-01' AND '2026-06-30'
ORDER BY a.date, a.period;
```

Resultado em `taximetro_preupgrade` (estado de 15/05 06:37 UTC):
- 22/05 → `CANCELLED`, `updated_at = 2026-05-06 02:34:05`, notes "CRU fixo semanal removido"
- 29/05 → `CANCELLED`, `updated_at = 2026-05-06 02:34:05`, notes "CRU fixo semanal removido"
- 05/06 → `SCHEDULED`, `created_at = 2026-05-06 02:35:30`, notes "CRU fixo semanal"
- 12/06 → `SCHEDULED`, `created_at = 2026-05-06 02:35:30`, notes "CRU fixo semanal"

**Idêntico ao estado atual.** Logo, o upgrade não tocou nesses registros.

### Fase 3 — audit_log decisivo

```sql
SELECT al.created_at, al.action, u.name AS actor, al.payload
FROM audit_log al LEFT JOIN users u ON u.id = al.user_id
WHERE al.created_at BETWEEN '2026-05-06 02:33:00' AND '2026-05-06 02:36:00'
ORDER BY al.created_at;
```

Os payloads de `CRU_FIXED_REMOVE` e `CRU_FIXED_ADD` provam a operação e mostram que o ADD reportou `skippedCount: 4` com as 4 datas-vítima nomeadamente.

### Fase 2.2 — escopo sistêmico do bug

```sql
WITH skipped_adds AS (
  SELECT al.created_at, (al.payload->>'internId')::uuid AS intern_id,
         al.payload->>'dayOfWeek' AS dow, al.payload->>'period' AS period,
         (al.payload->'materialized'->>'createdCount')::int AS created_cnt,
         (al.payload->'materialized'->>'skippedCount')::int AS skipped_cnt,
         al.payload->'materialized'->'skipped' AS skipped_array,
         u.name AS actor
  FROM audit_log al LEFT JOIN users u ON u.id = al.user_id
  WHERE al.action = 'CRU_FIXED_ADD'
    AND (al.payload->'materialized'->>'skippedCount')::int > 0
)
SELECT … FROM skipped_adds
WHERE skipped_array @> '[{"status":"CANCELLED"}]'::jsonb;
```

→ 18 eventos, 13 internas, 65 datas. Vide tabela acima.

---

## Cura aplicada — 2026-05-20 12:44 UTC

**Descoberta refinada**: das 14 datas futuras inicialmente listadas, 10 já estavam **auto-resolvidas** — execuções posteriores de `CRU_FIXED_GENERATE` ou reativações manuais via `REACTIVATE_CANCELLED_ASSIGNMENT` (ação que o sistema já expõe) criaram novos `SCHEDULED` com IDs distintos para as mesmas `(intern, date, period)`. Os CANCELLED ficaram de fantasmas no histórico, mas a interna está coberta.

**Remanescentes reais — 4 plantões reativados:**

| Interna | Data | Period | Assignment ID | audit_log ID da cura |
|---|---|---|---|---|
| Júlia Amado Moura | 2026-05-22 | DAY | `f73d0b77-13ff-44b0-907d-eae463e756a5` | `cc900e9a-4642-427e-849b-6002eec6fd87` |
| Júlia Amado Moura | 2026-05-29 | DAY | `9561b4ed-501b-458f-87b5-89afa1307f93` | `de430d1a-f1ce-44f2-b193-f4448bca6862` |
| Tainá Cardoso Santos | 2026-05-22 | DAY | `ffbd397d-31e9-4482-bc7d-54f2be73db14` | `5e409e63-5051-4750-b523-e3b8a991f886` |
| Tainá Cardoso Santos | 2026-05-29 | DAY | `393b4ddf-712c-4c28-9125-3ff62af8a185` | `93a144f6-30e1-4a9f-8dc9-3f07fc9de19e` |

**SQL executado:**
```sql
UPDATE assignments
SET status = 'SCHEDULED',
    notes = 'CRU fixo semanal (reativado: bug CRU_FIXED_ADD/REMOVE 2026-05-06)',
    updated_at = now()
WHERE id IN (
  'f73d0b77-13ff-44b0-907d-eae463e756a5',
  '9561b4ed-501b-458f-87b5-89afa1307f93',
  'ffbd397d-31e9-4482-bc7d-54f2be73db14',
  '393b4ddf-712c-4c28-9125-3ff62af8a185'
)
AND status = 'CANCELLED'
RETURNING …;
-- UPDATE 4
```

Acompanhado por `INSERT INTO audit_log` (action `REACTIVATE_CANCELLED_ASSIGNMENT`) para cada um, atribuído a Caio Oliveira com `curationContext` apontando para este relatório.

**Justificativa**: reativar (`UPDATE status`) preserva `id`, `created_at`, `created_by` originais — mais fidedigno do que re-materializar pelos templates, que criaria registros novos atribuídos ao operador atual. Os 4 alvos têm a assinatura clara do bug (notes "CRU fixo semanal removido" + audit_log mostrando `CRU_FIXED_ADD` com `skippedCount > 0` para essas datas).

## Próximas ações recomendadas

### 1. ~~Cura manual~~ ✅ FEITO em 2026-05-20 12:44 UTC

Continua válido para o futuro: monitorar audit_log com query abaixo a cada deploy, e curar conforme aparecer:
```sql
SELECT al.created_at, u.name AS interna, al.payload->'materialized'->'skipped' AS perdidos
FROM audit_log al
JOIN users u ON u.id = (al.payload->>'internId')::uuid
WHERE al.action = 'CRU_FIXED_ADD'
  AND al.payload->'materialized'->'skipped' @> '[{"status":"CANCELLED"}]'::jsonb
ORDER BY al.created_at DESC;
```

### 2. PATCH NO CÓDIGO — risco médio, prioridade alta
`CRU_FIXED_ADD` precisa decidir: ao materializar uma data que existe como `CANCELLED`, **reativar** em vez de pular. Ou no mínimo expor um botão "reativar canceladas" na UI antes do `skippedCount > 0` virar dado perdido. Procurar implementação:
```bash
grep -rn "CRU_FIXED_ADD\|skippedCount" src/
```

### 3. COMUNICAÇÃO — Júlia primeiro
Mensagem direta para Júlia Amado: explicar que o upgrade não causou nada, que as datas dela serão reativadas, e pedir desculpas pela percepção. Listar nomeadamente: 22/05 e 29/05 (DAY/Central Reg) voltarão.

Depois, comunicar individualmente as outras 12 internas (lista acima) com a mesma mensagem.

### 4. HARDENING — dívida técnica
- Auditar `audit_log` para campo `date` de `assignments` (atualmente o audit captura ação mas não diff de campo) — útil quando reclamações similares acontecerem.
- Adicionar teste de integração para `CRU_FIXED_ADD` cobrindo o cenário "data alvo já CANCELLED" — esperado: reativar, não pular.
- Considerar trigger ou job que detecte automaticamente `CRU_FIXED_ADD` com `skippedCount > 0 AND skipped[].status='CANCELLED'` e dispare alerta no Telegram.

---

## Pontos cegos conhecidos

- `audit_log` não captura diff de campo (só action + payload). Se algum dia houver mutação direta em `assignments.date` por SQL fora da app, não saberíamos. Sugiro trigger `AFTER UPDATE` em `assignments` que registre mudanças de `date`.
- O dump pré-upgrade é diário 03:37 BRT. Janela de até 24h entre dump e estado de prod no momento do upgrade — neste caso irrelevante porque o evento foi 9 dias antes do dump.
- Não verifiquei se algum outro intern teve `date` mudada por uma operação DIFERENTE do bug `CRU_FIXED_ADD` (queries acima já cobrem isso: 0 datas mudaram).

---

## Limpeza pós-investigação

Quando concluir, dropar o banco temporário (não é rotina):
```bash
sudo -u postgres dropdb taximetro_preupgrade
```
