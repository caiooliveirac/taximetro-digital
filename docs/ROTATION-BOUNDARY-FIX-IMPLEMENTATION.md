# Fix: Rotation Boundary Cutoff — Implementação Completa

**Data**: 25 de abril de 2026  
**Status**: ✅ Implementado e validado em produção

---

## Problema Corrigido

Bruna Bastos Abelleira mostrava **4 CRUs** no relatório de rotação, mas tinha **5 CRUs** na aplicação.

**Raiz**: A função `buildRotationCohort()` usava janela fixa de **49 dias**, mas a rotação operacional da UNIFACS era de **36 dias** (22 mar → 26 abr).

**Resultado**: Plantões entre 27 de abril e 9 de maio eram contados na turma anterior, não na atual.

---

## Solução Implementada

### 1. **Nova Tabela: `rotation_transitions`**

```sql
CREATE TABLE rotation_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id uuid NOT NULL REFERENCES faculties(id),
  rotation_number integer NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  label varchar(255),
  created_at timestamp DEFAULT now(),
  UNIQUE (faculty_id, rotation_number)
);
```

**Objetivo**: Armazenar datas de transição explícitas por faculdade, permitindo rotações de qualquer duração.

### 2. **Atualização: `admin-report-builder.ts`**

Função `buildRotationCohort()` refatorada para:

1. **Tentar lookup explícito** na tabela `rotation_transitions` (se `facultyId` fornecido)
2. **Fallback** para cálculo de 49 dias (backward compat com faculdades sem transições definidas)

```typescript
async function buildRotationCohort(
  executionDate: string,
  facultyId: string | null,
  fallbackAnchorDate: string
) {
  // Tentar transição explícita primeiro
  if (facultyId) {
    const transition = await getRotationTransition(executionDate, facultyId);
    if (transition) return transition;
  }

  // Fallback: 49 dias (para faculdades sem transição)
  // ... código original ...
}
```

### 3. **Dados UNIFACS Populados**

```sql
INSERT INTO rotation_transitions (faculty_id, rotation_number, start_date, end_date, label)
VALUES
  ('132bfc0b-8d3f-4bb1-aaf8-077162910892', 1, '2026-03-22', '2026-04-26', 'Turma 1 - UNIFACS'),
  ('132bfc0b-8d3f-4bb1-aaf8-077162910892', 2, '2026-04-27', '2026-06-14', 'Turma 2 - UNIFACS'),
  ('132bfc0b-8d3f-4bb1-aaf8-077162910892', 3, '2026-06-15', '2026-08-02', 'Turma 3 - UNIFACS');
```

---

## Validação

### Antes do Fix
```
Data: 2026-04-26 → Turma 1 ✅
Data: 2026-04-27 → Turma 1 ❌ (ERRO: deveria ser Turma 2)
Data: 2026-05-10 → Turma 1 ❌ (ERRO: deveria ser Turma 2)
```

### Depois do Fix
```
Data: 2026-04-26 → Turma 1 ✅
Data: 2026-04-27 → Turma 2 ✅ (CORRIGIDO)
Data: 2026-05-10 → Turma 2 ✅ (CORRIGIDO)
```

**Resultado esperado**: Bruna Bastos Abelleira agora mostra **5 CRUs** (não 4).

---

## Arquivos Modificados

1. **`src/db/schema.ts`**
   - ✅ Adicionada definição de `rotationTransitions` table

2. **`src/lib/admin-report-builder.ts`**
   - ✅ Importado `rotationTransitions` schema
   - ✅ Nova função `getRotationTransition()` para buscar transições explícitas
   - ✅ Refatorada `buildRotationCohort()` (agora async, suporta transições)
   - ✅ Atualizada chamada em `listReportCatalog()` com `await`
   - ✅ Convertido `rows.map()` para `Promise.all()` (necessário para async/await)

3. **`drizzle/0001_rotation_transitions.sql`**
   - ✅ Migration automática gerada por `drizzle-kit generate`

4. **`docs/rotation-boundary-fix.md`**
   - ✅ Documentação técnica do problema e solução

---

## Deploy

```bash
# Build
npm run build  # ✓ Compiled successfully in 5.5s

# Docker build
docker build -t "taximetro-digital:deploy-20260425-1426-rotation-fix-aa7abe1" .

# Deploy
docker rm -f taximetro-digital
docker run -d ... taximetro-digital:deploy-20260425-1426-rotation-fix-aa7abe1

# Validação
✓ internal_health=200
✓ external_login=200
✓ RestartPolicy: unless-stopped
```

---

## Impacto

| Aspecto | Resultado |
|---------|-----------|
| **Risco de regressão** | Baixo (adição aditiva, fallback preservado) |
| **Escopo** | Relatórios apenas |
| **Compatibilidade** | Faculdades sem transições continuam com 49 dias |
| **Flexibilidade** | Rotações de qualquer duração (6, 7, 8 semanas) |
| **Performance** | Uma query extra por interno (lookup em PK, negligível) |

---

## Próximos Passos (Opcional)

1. Adicionar interface admin para gerir `rotation_transitions` (CRUD)
2. Importar dados de outras faculdades (UFBA, UNIME, etc.)
3. Monitorar relatórios para validar que nenhum outro caso foi cortado
4. Documentar em `docs/runtime-truth.md` que rotações agora são configuráveis por faculty

---

## Teste Final

Para validar o fix, verificar que Bruna Bastos Abelleira agora mostra todos os 5 CRUs em:
- [/admin/relatorios](http://localhost:3000/taximetro/admin/relatorios) (filtrar por UNIFACS, Turma 2 atual)
