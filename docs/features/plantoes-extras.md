# Plantões Extras

> Funcionalidade implementada em: maio 2025

## O que é

Um board público de **plantões extras** — vagas avulsas fora da escala regular de rotação.  
Quando um plantão fica vago e não será preenchido pela escala automática, a coordenação (ou um líder) pode publicar a vaga como "extra". Internos e líderes disputam o plantão de forma **first-come-first-served**: o primeiro a apertar "Pegar" garante o plantão.

> ⚠️ Plantões extras **não contabilizam** a carga horária obrigatória da rotação.

---

## Fluxo geral

```
COORDINATOR / LEADER
        ↓ publica extra (base, data, turno, notas)
  [extra_shift_offers row, claimedBy=NULL]
        ↓
INTERN / LEADER vê no board → clica "Pegar"
        ↓ POST /api/extra-offers/{id}
  [assignments row com isExtraShift=true]
  [claimedBy=actor.id, assignmentId=FK]
```

Se dois usuários tentam pegar ao mesmo tempo, o `claimExtraOffer` usa `UPDATE … WHERE claimed_by IS NULL` — somente um recebe 1 linha afetada; o outro recebe 409.

---

## Banco de dados

### Tabela `extra_shift_offers`

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | Identificador |
| `base_id` | uuid FK → bases | Base do plantão |
| `date` | date | Data do plantão |
| `period` | `shiftPeriodEnum` | DAY / NIGHT |
| `shift` | text | MORNING / AFTERNOON (opcional) |
| `faculty_id` | uuid FK → faculties | Faculdade específica (opcional) |
| `notes` | text | Observações |
| `published_by` | uuid FK → users | Quem publicou |
| `published_at` | timestamp | Quando publicou |
| `claimed_by` | uuid FK → users | Quem pegou (NULL = disponível) |
| `claimed_at` | timestamp | Quando pegou |
| `assignment_id` | uuid FK → assignments | Plantão criado ao ser pego |
| `cancelled_at` | timestamp | Quando cancelado |
| `cancelled_by` | uuid FK → users | Quem cancelou |

**Índices**: `idx_extra_offer_date`, `idx_extra_offer_base`, `idx_extra_offer_claimed_by`

**Migration**: `drizzle/0014_extra_shift_offers.sql`

---

## API

### `GET /api/extra-offers`

| Role | Comportamento |
|---|---|
| `COORDINATOR` | Retorna histórico completo |
| Outros | Retorna apenas disponíveis (não reclamados, não cancelados) |

Query param `?all=true`: forçar retorno completo (para líderes verem histórico próprio).

### `POST /api/extra-offers`

Publica um novo extra. Roles: `COORDINATOR`, `LEADER`.

Body:
```json
{
  "baseId": "uuid",
  "date": "2025-05-15",
  "period": "DAY",
  "shift": "MORNING",     // opcional
  "facultyId": "uuid",    // opcional
  "notes": "Cobertura de falta"
}
```

### `POST /api/extra-offers/{id}`

Reclama (pega) um plantão extra. Roles: `INTERN`, `LEADER`.

- Cria um `assignments` row com `isExtraShift: true`
- Faz claim atômico na oferta
- Se race condition → 409

### `DELETE /api/extra-offers/{id}`

Cancela uma oferta (apenas se não foi reclamada). Roles: `COORDINATOR`, `LEADER`.

### `GET /api/extra-offers/analytics`

Analytics de extras. Role: `COORDINATOR`.

Query params opcionais: `?from=YYYY-MM-DD&to=YYYY-MM-DD`

Retorna:
```json
{
  "byFaculty": [{ "facultyName": "...", "total": 5, "claimed": 3 }],
  "byClaimer": [{ "claimerName": "...", "claimedCount": 3 }],
  "byBase": [{ "baseName": "...", "baseCode": "...", "total": 2 }]
}
```

---

## Views

### Admin (`/admin/plantoes-extras`)

- 4 stat cards: Publicados / Preenchidos / Disponíveis / Cancelados
- Analytics: por faculdade, por quem pegou (ranking), por base
- Tabs: "Disponíveis" / "Histórico"
- Botão cancelar em cada oferta disponível

### Admin — grade de escala (`admin-filled-schedule.tsx`)

Botão ⚡ adicionado em vagas não preenchidas (`VacancySlotCard`) e slots livres (`OpenSlotCard`).  
Clicando abre modal `PublishExtraModal` com:
- Aviso explicativo
- Detalhes do slot (base, data, turno)
- Textarea de observações
- Botão "Publicar como Extra" → POST `/api/extra-offers`

### Intern (`/intern/extras`)

- Warning de "não conta carga horária"
- Tabs: "Disponíveis" / "Meus Extras"
- Cada card: base, data, turno, faculdade (se definida), notas, botão "⚡ Pegar"
- Feedback em tempo real (success / race condition / error)

### Leader (`/leader/extras`)

- Tabs: "Disponíveis (N)" / "Histórico" / "Publicar"
- "Disponíveis": mesma UX que intern + botão cancelar (para o líder remover uma oferta ainda não preenchida)
- "Histórico": todos (claimed/cancelled/available) com badges de status
- "Publicar": form com base, data, turno, observação → POST `/api/extra-offers`

---

## Regras de negócio

1. **Verificação de conflito**: ao pegar um extra, o sistema verifica se o claimer já possui um `assignment` ativo na mesma data/período. Se sim, 409.
2. **Race condition**: o UPDATE atomico garante consistência — apenas um usuário ganha a oferta, mesmo com requisições simultâneas.
3. **Não conta carga**: `isExtraShift: true` no assignment — a lógica de progresso de rotação ignora esses plantões.
4. **Permissões de cancelar**: apenas `COORDINATOR` e `LEADER` podem cancelar ofertas (apenas enquanto `claimedBy IS NULL`).

---

## Arquivos modificados / criados

| Arquivo | Mudança |
|---|---|
| `drizzle/0014_extra_shift_offers.sql` | Novo — migration |
| `drizzle/meta/_journal.json` | Atualizado com nova entry |
| `src/db/schema.ts` | Nova tabela `extraShiftOffers` |
| `src/features/extra-offers/infra/repositories/extra-offer-repository.ts` | Novo |
| `src/features/extra-offers/application/use-cases/publish-extra-offer.ts` | Novo |
| `src/features/extra-offers/application/use-cases/claim-extra-offer.ts` | Novo |
| `src/features/extra-offers/application/use-cases/cancel-extra-offer.ts` | Novo |
| `src/app/api/extra-offers/route.ts` | Novo |
| `src/app/api/extra-offers/[id]/route.ts` | Novo |
| `src/app/api/extra-offers/analytics/route.ts` | Novo |
| `src/components/admin-filled-schedule.tsx` | Botão ⚡ + PublishExtraModal |
| `src/app/admin/plantoes-extras/page.tsx` | Novo — admin board |
| `src/app/admin/layout.tsx` | Nav "Extras" adicionado |
| `src/app/intern/extras/page.tsx` | Novo — intern board |
| `src/app/intern/layout.tsx` | Nav "Extras" adicionado, grid-cols-8 |
| `src/app/leader/extras/page.tsx` | Novo — leader board |
| `src/app/leader/layout.tsx` | Nav "Extras" adicionado |
