# Filtragem de Papéis em Scheduling e Alocação

## Contexto do Problema

Antes de 2026-04-20, o sistema permitia que usuários com papel LEADER fossem incluídos em operações de scheduling (sorteio, alocação manual, requisições). Isso causava:

1. **Zarns**: Líderes que não deveriam ser escaláveis (Ana Beatriz Andrade, Lucas Correia, Thainá Brasileiro Santos) apareciam no sorteio e na alocação manual.
2. **Outras faculdades**: Líderes que precisavam ser escaláveis (ex: Bianca Varjão em UNIFACS) eram difíceis de alocar porque o sistema aceitava LEADER mas não garantia que tivessem a role INTERN.

## Solução Implementada

**Regra de Ouro**: Apenas usuários com papel **INTERN** podem ser alocados em plantões.

Líderes que precisam ser escaláveis devem ter **AMBOS** os papéis: LEADER + INTERN.

### Arquivos Modificados (commit b9c5974)

5 functions tiveram `inArray(userRoles.role, ["INTERN", "LEADER"])` removido para `eq(userRoles.role, "INTERN")`:

1. **src/features/user-management/infra/repositories/user-management-repository.ts**
   - `listFacultyInternRows(facultyId)` — lista interns para o endpoint `/api/leader/interns`
   - Impacto: Endpoint que carrega lista de internos para o líder ver, alocar manualmente, ou incluir no sorteio

2. **src/features/scheduling/infra/repositories/lottery-repository.ts**
   - `getValidInternIdsForFaculty(params)` — valida IDs de interns para sorteio
   - Impacto: Sorteio (lottery) agora aceita apenas INTERN, ignorando LEADER-only

3. **src/features/scheduling/infra/repositories/cru-fixed-repository.ts**
   - `internBelongsToFaculty(params)` — verifica se intern pertence à faculdade
   - Impacto: Bloqueio de CRU fixo agora funciona apenas para INTERN

4. **src/features/requests/infra/repositories/request-repository.ts**
   - `findFacultyInternIds(facultyId)` — lista interns da faculdade para requisições de troca
   - `findRequesterFacultyRole(requesterId)` — valida papel do solicitante de requisição
   - Impacto: Requisições de troca/extra agora apenas entre INTERN

## Padrão de Papéis por Faculdade (Apr 2026)

```
ZARNS:
  - Ana Beatriz Andrade      → LEADER only    ✓ (não escalável)
  - Lucas Correia            → LEADER only    ✓ (não escalável)
  - Thainá Brasileiro Santos → LEADER only    ✓ (não escalável)
  - 51 interns               → INTERN only    ✓ (escaláveis)

UNIFACS:
  - Bianca Varjão Gomes             → LEADER + INTERN  ✓ (escalável)
  - Maria Eduarda Pinheiro Brandão  → LEADER + INTERN  ✓ (escalável)
  - ~100+ interns                   → INTERN only      ✓ (escaláveis)

EBMSP, UFBA, AFYA:
  - Similar pattern: 2 leaders com LEADER+INTERN (escaláveis), 2 com LEADER-only (não)
```

## Como Verificar/Testar

### Query para validar padrão:
```sql
-- Contar LEADER-only vs LEADER+INTERN por faculdade
SELECT 
  f.abbreviation,
  'LEADER+INTERN' as pattern,
  COUNT(DISTINCT ur.user_id) as count
FROM user_roles ur
JOIN faculties f ON f.id = ur.faculty_id
WHERE ur.role = 'LEADER' AND ur.is_active = true
GROUP BY f.abbreviation
UNION ALL
SELECT 
  f.abbreviation,
  'LEADER only' as pattern,
  COUNT(DISTINCT ur.user_id) as count
FROM user_roles ur
JOIN faculties f ON f.id = ur.faculty_id
WHERE ur.role = 'LEADER' AND ur.is_active = true
  AND ur.user_id NOT IN (
    SELECT user_id FROM user_roles 
    WHERE role = 'INTERN' AND is_active = true AND faculty_id = f.id
  )
GROUP BY f.abbreviation
ORDER BY abbreviation, pattern;
```

### Teste funcional:
1. Acesse `/leader/escala` como líder de ZARNS
   - Resultado esperado: Ana Beatriz, Lucas, Thainá NÃO aparecem na lista de interns
2. Acesse `/leader/escala` como líder de UNIFACS
   - Resultado esperado: Bianca e Maria Eduarda APARECEM na lista de interns

## Impacto em Outros Componentes

- **Compliance**: Líderes com LEADER-only não são contados em indicadores de compliance
- **Audit logs**: Operações de alocação só registram INTERN, não LEADER
- **Email/Telegram notificações**: Apenas INTERN recebem notificações de alocação
- **Swap/Extra shift requests**: Apenas entre usuários com INTERN

## Para Agentes Futuros

Se precisar adicionar um novo líder escalável:
```sql
-- 1. Verificar que o líder tem LEADER role
SELECT * FROM user_roles WHERE user_id = 'uuid-do-lider' AND role = 'LEADER';

-- 2. Adicionar INTERN role se não tiver
INSERT INTO user_roles (id, user_id, role, faculty_id, is_active, is_archived)
VALUES (gen_random_uuid(), 'uuid-do-lider', 'INTERN', 'faculty-uuid', true, false)
ON CONFLICT DO NOTHING;

-- 3. Validar
SELECT u.name, ur.role FROM user_roles ur
JOIN users u ON u.id = ur.user_id
WHERE u.id = 'uuid-do-lider' AND ur.is_active = true;
```

Se um líder NÃO deve ser escalável, deixe apenas LEADER (sem INTERN).

## Notas Importantes

- Este padrão é retroativo: aplicável a toda alocação futura
- Mudanças de papel afetam IMEDIATAMENTE a próxima operação de escala/sorteio
- Não há campo especial "is_leader_schedulable" — o sistema usa presença de INTERN role
- LEADER-only nunca é filtrado de outras operações administrativas (ver user, audit, etc)
