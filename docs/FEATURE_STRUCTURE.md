# 🗺️ Estrutura de Features — Como Encontrar Tudo

## Problema

Quando há um bug ou problema em produção (ex: "interface de ocorrências deu problema"), você precisa:
1. **Localizar** a interface/página/API
2. **Entender** o fluxo de dados
3. **Debugar** rápido

Este guia ajuda com isso.

---

## 📁 Estrutura Geral

```
src/
├── app/                           # Next.js App Router
│   ├── (auth)/                    # Páginas públicas (login, etc)
│   ├── intern/                    # 👤 ROTAS DO INTERN
│   │   ├── page.tsx               # Dashboard do intern (/intern)
│   │   ├── checkin/               # Check-in/checkout
│   │   ├── ocorrencias/           # 🏥 OCORRÊNCIAS CLÍNICAS ← aqui!
│   │   │   └── page.tsx           # Formulário de registro
│   │   └── trocas/                # Requisições de swap/extra
│   ├── admin/                     # 👨‍💼 ROTAS DO COORDENADOR
│   │   ├── dashboard/
│   │   ├── ver-interno/           # Visualiza internos + ocorrências
│   │   └── ...
│   ├── leader/                    # 👨‍🏫 ROTAS DO LÍDER
│   │   ├── internos/              # Visualiza internos + ocorrências
│   │   └── ...
│   └── api/                       # API Routes (Next.js)
│       ├── case-records/          # POST/GET para ocorrências
│       ├── assignments/           # Plantões
│       ├── checkins/              # Check-in/checkout
│       └── ...
│
├── features/                      # Lógica de domínio (limpa, reutilizável)
│   ├── case-records/              # 🏥 Feature de Ocorrências
│   │   ├── application/           # Use cases (orquestração)
│   │   │   └── use-cases/
│   │   │       ├── create-case-record.ts
│   │   │       └── list-case-records.ts
│   │   └── infra/                 # Repositórios (acesso a dados)
│   │       └── repositories/
│   │           └── case-record-repository.ts
│   ├── assignments/               # Plantões
│   ├── checkins/                  # Check-in/checkout
│   └── ...
│
├── shared/                        # Código compartilhado
│   ├── db/                        # Cliente e schema do Drizzle
│   │   ├── client.ts              # Conexão com PG
│   │   └── schema.ts              # Definições de tabelas
│   ├── infra/                     # Serviços compartilhados
│   │   ├── rate-limit/
│   │   └── ...
│   └── domain/                    # Lógica de domínio compartilhada
│       ├── policies/              # Regras de negócio
│       │   └── attendance-window-policy.ts
│       └── ...
│
├── lib/                           # Utilitários e helpers
│   ├── auth.ts                    # NextAuth config
│   ├── impersonate.ts             # Lógica de impersonação
│   ├── utils.ts                   # Funções genéricas
│   └── ...
│
├── components/                    # Componentes React reutilizáveis
│   ├── ui/                        # Componentes "burros" (Button, Input, etc)
│   ├── status-badge.tsx           # Componente específico
│   └── ...
│
└── middleware.ts                  # Auth guard e redirects
```

---

## 🔍 Como Encontrar uma Feature

### Cenário: "Ocorrências clínicas deram problema"

**Passo 1: Localizar a página**
```bash
# Procure em src/app/*/
find src/app -type f -name "*ocorrencia*" -o -name "*case*"
# Resultado: src/app/intern/ocorrencias/page.tsx
```

**Passo 2: Entender o fluxo da UI**
```bash
# Abrir a página
cat src/app/intern/ocorrencias/page.tsx
# Procure por: fetch("/taximetro/api/...") para saber quais APIs usa
```

**Passo 3: Encontrar a API**
```bash
# A página faz POST /api/case-records
# Então procure em:
cat src/app/api/case-records/route.ts
```

**Passo 4: Encontrar a lógica**
```bash
# A rota chama useCase (create, list, etc)
# Procure em:
cat src/features/case-records/application/use-cases/
```

**Passo 5: Encontrar o repositório**
```bash
# O useCase chama repository
# Procure em:
cat src/features/case-records/infra/repositories/
```

**Passo 6: Entender o schema**
```bash
# O repositório usa tabela "case_records"
# Schema em:
grep -A 10 "case_records\|caseRecords" src/shared/db/schema.ts
```

---

## 📋 Mapa de Features Principais

### 🏥 Ocorrências Clínicas
| Caminho | O quê |
|---------|-------|
| `src/app/intern/ocorrencias/page.tsx` | Interface do intern |
| `src/app/api/case-records/route.ts` | Endpoints POST/GET |
| `src/features/case-records/application/use-cases/` | Lógica de negócio |
| `src/features/case-records/infra/repositories/` | Acesso a dados |
| `src/shared/db/schema.ts:190-198` | Definição da tabela |

### 👤 Attendance (Check-in/Checkout)
| Caminho | O quê |
|---------|-------|
| `src/app/intern/checkin/page.tsx` | Interface de check-in |
| `src/app/api/checkins/route.ts` | Endpoints |
| `src/features/checkins/` | Lógica |
| `src/shared/domain/policies/attendance-window-policy.ts` | Regras de horário |

### 📅 Assignments (Plantões)
| Caminho | O quê |
|---------|-------|
| `src/app/api/assignments/route.ts` | Lista plantões |
| `src/features/assignments/` | Lógica |
| `src/shared/db/schema.ts:120-150` | Tabela assignments |

### 🔄 Requests (Swap/Extra/Drop)
| Caminho | O quê |
|---------|-------|
| `src/app/intern/trocas/page.tsx` | Interface de requisições |
| `src/app/api/requests/route.ts` | Endpoints |
| `src/features/requests/` | Lógica |

---

## 🔌 Padrão API → Use Case → Repository

Toda feature segue este padrão:

```
src/app/api/case-records/route.ts
    ↓
const user = await getEffectiveUser(req)  // Validar autenticação
const body = await req.json()              // Ler body
const parsed = schema.safeParse(body)      // Validar com Zod
    ↓
import { executeCreateCaseRecord } from "@/features/case-records/..."
const result = await executeCreateCaseRecord({
  actorId: user.id,
  input: parsed.data
})
    ↓
src/features/case-records/application/use-cases/create-case-record.ts
    ↓
const count = await countCaseRecordsForAssignment(...)  // Query 1
const created = await createCaseRecord({...})           // Insert
    ↓
src/features/case-records/infra/repositories/case-record-repository.ts
    ↓
await db.insert(caseRecords).values({...})  // SQL real
await db.select().from(caseRecords).where(...)
```

**Regra**: Cada layer tem responsabilidade clara:
- **Route**: HTTP, autenticação, serialização
- **Use Case**: Orquestração, validação de regra de negócio
- **Repository**: SQL puro, acesso a dados

---

## 🔐 Segurança — Onde Checkar

| Aspecto | Arquivo | O quê Procurar |
|---------|---------|---|
| **Autenticação** | `src/middleware.ts` | Auth guard, redirects |
| | `src/lib/auth.ts` | Config NextAuth |
| | `src/lib/impersonate.ts` | Lógica de impersonação |
| **Filtragem por role** | API routes | `const user = await getEffectiveUser(req)` |
| **Validação de input** | Use cases | `schema.safeParse(body)` com Zod |
| **SQL injection** | Repositories | Sempre usar `db.insert().values({})` (Drizzle cuida) |
| **XSS** | Componentes React | Procurar por `dangerouslySetInnerHTML` |

---

## 🧪 Testing — Onde Estão?

```bash
tests/
├── *.test.ts          # Testes (node:test + tsx)
├── fixtures/          # Mock data
└── setup.ts           # Configuração global
```

**Como rodar**:
```bash
npm test
npm test -- --grep "case-record"  # Filtrar por pattern
```

---

## 🐛 Debugging Rápido

### Problema: "Ocorrências não aparecem para o intern"

**Passo 1: Verificar se estão no banco**
```bash
psql postgresql://taximetro:taximetro_dev@localhost:5436/taximetro -c \
  "SELECT * FROM case_records WHERE intern_id = 'UUID_DO_INTERN';"
```

**Passo 2: Verificar a API**
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3000/taximetro/api/case-records
```

**Passo 3: Verificar a filtragem**
```bash
# Abrir: src/features/case-records/application/use-cases/list-case-records.ts
# Procurar por: if (actor.role === 'INTERN') { filter by internId }
```

**Passo 4: Verificar a UI**
```bash
# Abrir DevTools (F12)
# Network tab → ver resposta do GET /api/case-records
# Se vazio → problema na API/banco
# Se preenchido mas não mostra → problema na renderização React
```

---

## 📚 Documentação Rápida

- **CLAUDE.md** — Setup inicial
- **AGENTS.md** — Regras para agentes
- **docs/runtime-truth.md** — Produção (Docker, Nginx)
- **docs/dev-agent-macbook.md** — Setup via Docker Compose
- **docs/FEATURE_STRUCTURE.md** ← você está aqui
- **src/db/schema.ts** — Comentários nas tabelas

---

## 🎯 Atalhos Úteis

**Encontrar uso de uma tabela**:
```bash
grep -r "case_records\|caseRecords" src/
```

**Encontrar uma função em repositórios**:
```bash
grep -r "createCaseRecord\|listCaseRecords" src/
```

**Encontrar rotas de uma feature**:
```bash
find src/app -path "*case*" -o -path "*ocorrencia*"
```

**Buscar por API endpoint**:
```bash
grep -r "POST.*case-records" src/
```

**Encontrar uso de uma API no frontend**:
```bash
grep -r "/taximetro/api/case-records" src/app
```

---

## ✅ Checklist para Debugar uma Feature

- [ ] Localizei a página (`src/app/...`)
- [ ] Entendi o fluxo (quais APIs ela chama)
- [ ] Encontrei o roteador API (`src/app/api/.../route.ts`)
- [ ] Encontrei o use case (`src/features/.../application/use-cases/`)
- [ ] Encontrei o repositório (`src/features/.../infra/repositories/`)
- [ ] Verifiquei o schema da tabela (`src/shared/db/schema.ts`)
- [ ] Testo a API diretamente (curl ou DevTools)
- [ ] Testo a query do banco (psql direto)
- [ ] Verifico a autenticação (`getEffectiveUser`)
- [ ] Verifico a validação (`Zod schema`)
- [ ] Verifico logs (NextAuth, Drizzle, aplicação)

---

## 🎓 Próxima Vez

Se houver problema similar:
1. Use este documento para **localizar em segundos**
2. Use `grep` e `find` para **navegar rápido**
3. Use `psql` para **testar banco diretamente**
4. Use DevTools para **ver resposta real da API**

**Tempo médio de localização**: 30 segundos  
**Tempo médio de debug**: 5-10 minutos (com este guia)
