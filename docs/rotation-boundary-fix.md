# Fix: Rotation Boundary Cutoff (Bruna Bastos Missing CRU)

## Problema Identificado

A função `buildRotationCohort()` em `src/lib/admin-report-builder.ts` usa uma **janela fixa de 49 dias**, mas a rotação operacional da UNIFACS é diferente:

- **Esperado**: Turma anterior até 26 de abril, Turma atual a partir de 27 de abril
- **Atual**: Turma anterior até 9 de maio (49 dias a partir de 22 de março), Turma atual a partir de 10 de maio

**Resultado**: Plantões entre 27 de abril e 9 de maio são contados na turma anterior, não na atual.

**Sintoma concreto**: Bruna Bastos Abelleira mostra 4 CRUs no relatório mas tem 5 CRUs na app.

---

## Raiz do Problema

```typescript
// ❌ LÓGICA ATUAL (admin-report-builder.ts:305)
const ROTATION_WINDOW_DAYS = 49; // 7 semanas fixas

function buildRotationCohort(executionDate: string, anchorDate: string) {
  const executionMs = Date.parse(`${executionDate}T12:00:00Z`);
  const anchorMs = Date.parse(`${anchorDate}T12:00:00Z`);
  const dayDiff = Math.floor((executionMs - anchorMs) / (24 * 60 * 60 * 1000));
  const windowIndex = Math.max(0, Math.floor(dayDiff / ROTATION_WINDOW_DAYS));
  // ... cálcula janela fixa
}
```

**Problema**: 
- Assume que todas as rotações têm exatamente 49 dias
- Na UNIFACS, a rotação 1 tem 36 dias (22 mar → 26 abr)
- Não há forma de configurar datas de transição explícitas

---

## Solução Recomendada

Criar uma tabela `rotation_transitions` no banco de dados para armazenar datas de transição explícitas por faculdade:

```sql
CREATE TABLE rotation_transitions (
  id SERIAL PRIMARY KEY,
  faculty_id UUID NOT NULL REFERENCES faculties(id) ON DELETE CASCADE,
  rotation_number INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  label VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE (faculty_id, rotation_number),
  CHECK (start_date <= end_date)
);

-- Dados UNIFACS
INSERT INTO rotation_transitions 
  (faculty_id, rotation_number, start_date, end_date, label)
VALUES
  ((SELECT id FROM faculties WHERE abbr = 'UNIFACS'), 1, '2026-03-22', '2026-04-26', 'Turma 1'),
  ((SELECT id FROM faculties WHERE abbr = 'UNIFACS'), 2, '2026-04-27', '2026-06-14', 'Turma 2'),
  ((SELECT id FROM faculties WHERE abbr = 'UNIFACS'), 3, '2026-06-15', '2026-08-02', 'Turma 3');
```

---

## Implementação: `admin-report-builder.ts`

### 1. Nova função para buscar transição

```typescript
async function getRotationTransition(
  executionDate: string,
  facultyId: string | null
): Promise<{ rotationNumber: number; label: string } | null> {
  if (!facultyId) return null;
  
  const transition = await db
    .select()
    .from(rotationTransitions)
    .where(
      and(
        eq(rotationTransitions.facultyId, facultyId),
        lte(rotationTransitions.startDate, executionDate),
        gte(rotationTransitions.endDate, executionDate)
      )
    )
    .limit(1);
  
  if (!transition.length) return null;
  
  return {
    rotationNumber: transition[0].rotation_number,
    label: transition[0].label || `Turma ${transition[0].rotation_number}`,
  };
}
```

### 2. Refatorar `buildRotationCohort()`

```typescript
export async function buildRotationCohort(
  executionDate: string,
  facultyId: string | null,
  fallbackAnchorDate: string
) {
  // Tentar usar transição explícita primeiro
  if (facultyId) {
    const transition = await getRotationTransition(executionDate, facultyId);
    if (transition) {
      return {
        key: `rotation-${transition.rotationNumber}`,
        label: transition.label,
      };
    }
  }
  
  // Fallback: usar 49 dias (para faculdades sem transição definida)
  const executionMs = Date.parse(`${executionDate}T12:00:00Z`);
  const anchorMs = Date.parse(`${fallbackAnchorDate}T12:00:00Z`);
  const dayDiff = Math.floor((executionMs - anchorMs) / (24 * 60 * 60 * 1000));
  const windowIndex = Math.max(0, Math.floor(dayDiff / ROTATION_WINDOW_DAYS));
  const windowStart = addDays(fallbackAnchorDate, windowIndex * ROTATION_WINDOW_DAYS);
  const windowEnd = addDays(windowStart, ROTATION_WINDOW_DAYS - 1);
  
  return {
    key: `${fallbackAnchorDate}-w${String(windowIndex + 1).padStart(2, "0")}`,
    label: `Turma ${windowIndex + 1} (${formatShortDate(windowStart)}-${formatShortDate(windowEnd)})`,
  };
}
```

### 3. Atualizar assinatura de `buildCatalogCohorts()`

```typescript
// Em listReportCatalog()
const rotation = await buildRotationCohort(
  assignment.date,
  row.facultyId,        // <-- NOVO: passou facultyId
  row.firstAssignmentDate
);
```

---

## Validação do Fix

Teste com os dados da UNIFACS:

```javascript
// Com fix aplicado:
findRotationByDate("2026-04-26", "unifacs") // → Turma 1 ✅
findRotationByDate("2026-04-27", "unifacs") // → Turma 2 ✅ (antes era Turma 1 ❌)
findRotationByDate("2026-05-10", "unifacs") // → Turma 2 ✅ (antes era Turma 1 ❌)
```

**Resultado esperado**: Bruna Bastos Abelleira passa de 4 CRUs para 5 CRUs no relatório.

---

## Impacto

- **Riscos baixos**: Mudança é aditiva (tabela nova, fallback preservado)
- **Scope**: Apenas relatórios (função não é usada em fluxo de check-in/escala)
- **Compatibilidade**: Faculdades sem transição definida continuam usando 49 dias
- **Vantagem**: Permite configuração precisa de rotações de qualquer duração (6, 7, 8 semanas)

---

## Próximos Passos

1. Criar migration Drizzle para `rotation_transitions` table
2. Implementar as funções acima em `admin-report-builder.ts`
3. Popular tabela com dados reais (UNIFACS + outros centros)
4. Testar relatório com Bruna Bastos (deve mostrar 5 CRUs)
5. Validar que nenhum relatório foi quebrado (backward compat)
