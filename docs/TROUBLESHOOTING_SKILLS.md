# 🔧 Skills para Troubleshooting — Como Usar o Claude Code Mais Rápido

## O Problema

Quando você encontra um problema em produção (tipo "ocorrências deram problema"), você precisa:

1. ❌ Descrever tudo manualmente
2. ❌ Esperar eu explorar o código inteiro
3. ❌ Perder tempo em back-and-forth

## ✅ A Solução: Skills do Claude Code

Use **skills** para fazer eu trabalhar mais rápido e melhor.

---

## 📚 Skills Disponíveis

### `/security-review`
Analisa segurança do código atual

**Quando usar**:
- Problema pode estar relacionado a autenticação/autorização
- Query suspeita ou input não validado
- Antes de fazer merge de mudanças sensíveis

**Exemplo**:
```
Problema: Internos conseguem ver ocorrências de outros internos
/security-review
```

### `/review`
Revisa um pull request

**Quando usar**:
- Para revisar mudanças que alguém fez
- Para debugar se uma mudança quebrou algo

**Exemplo**:
```
/review  # Revisa o PR atual
```

### `/simplify`
Revisa código para melhorias

**Quando usar**:
- Código está complexo ou duplicado
- Quer simplificar implementação

**Exemplo**:
```
/simplify
```

### `/init`
Cria documentação inicial (CLAUDE.md)

**Quando usar**:
- Projeto novo ou precisa reorganizar docs
- Raríssimo neste projeto

---

## 🎯 Melhores Práticas para Troubleshooting

### Cenário 1: "Feature XYZ deu problema em produção"

**❌ Errado:**
```
Oi, ocorrências clínicas deram problema. Consegue debugar?
```

**✅ Certo:**
```
Ocorrências clínicas não estão sendo salvas em produção.
Reproduzi localmente: /intern/ocorrencias → registrei 5 casos → nenhum apareceu no banco.

Contexto:
- Local: Node 20, Postgres 16, Docker
- Produção: (descrever)

Steps:
1. Acessar /intern/ocorrencias
2. Selecionar plantão
3. Preencher "PCR" como nickname
4. Clicar Registrar
5. Esperar sucesso
6. Verificar banco: SELECT * FROM case_records WHERE ...
   → Esperado: 5 linhas
   → Obtido: 0 linhas

Próximos passos: Debugar onde a inserção está falhando.
```

---

### Cenário 2: "Erro 401 ao registrar ocorrência"

**❌ Errado:**
```
Tá dando erro 401 ao registrar. Conserta?
```

**✅ Certo:**
```
Erro 401 ao fazer POST /api/case-records com body válido.

Teste:
curl -X POST http://localhost:3000/taximetro/api/case-records \
  -H "Content-Type: application/json" \
  -H "Cookie: authjs.session-token=MEUTOKEN" \
  -d '{"assignmentId":"UUID","nickname":"PCR"}'

Resposta:
{
  "success": false,
  "error": "Não autenticado"
}

Análise:
- Token válido? ✓ (consegui fazer outras requisições autenticadas)
- NextAuth sessão ativa? ✓ (consegui acessar /intern/dashboard)
- Cookie name certo? → preciso verificar

Próximos passos: Debugar por que getEffectiveUser retorna null.
```

**Agora eu posso:**
1. Ir direto em `src/lib/auth.ts` e `src/middleware.ts`
2. Verificar a lógica de `getEffectiveUser`
3. Propor fix específica

---

### Cenário 3: "Alguns internos veem ocorrências de outros"

**❌ Errado:**
```
Tem um problema de permissão nas ocorrências.
```

**✅ Certo:**
```
Bug: Intern A consegue ver ocorrências de Intern B.

Reprodução:
1. Login como intern.001@dev.local
2. GET /api/case-records
3. Vejo 5 ocorrências
4. Logout, login como intern.002@dev.local
5. GET /api/case-records
6. Vejo as mesmas 5 ocorrências (ERRO!)

Esperado: Cada intern vê apenas suas próprias ocorrências

Análise prévia:
- Verifiquei src/features/case-records/application/use-cases/list-case-records.ts
- Não vejo filtragem por internId quando actor.role === 'INTERN'
- Suspeita: Linha 15-20 está retornando todos os casos

/security-review  ← Execute este skill
```

**Agora eu:**
1. Executar `/security-review` para análise completa
2. Encontrar exatamente onde a filtragem falha
3. Propor fix específica

---

## 🚀 Skills Workflow para Problemas Comuns

### Problema: "Feature quebrada"

```
1. Descrever o problema com detalhes (passo-a-passo)
2. Descrever o esperado vs. obtido
3. Mencionar ambiente (local vs. prod)
4. Eu localizo em 30 segundos (usando docs/FEATURE_STRUCTURE.md)
5. Eu debugo em 5-10 minutos
6. Eu proponho fix
7. /security-review (se sensível)
8. /review (se PRed)
```

### Problema: "Lentidão"

```
1. Descrever sintoma (qual operação está lenta)
2. Rodou /performance-check? (se existir)
3. Eu uso /simplify para revisar código
4. Eu sugiro índices ou query optimization
```

### Problema: "Erro de autenticação"

```
1. Descrever erro exato (401? 403?)
2. Cookie/token sendo enviado?
3. Eu leio src/lib/auth.ts
4. /security-review para validação
5. Fix no getEffectiveUser ou middleware
```

---

## 📋 Template para Reportar Bug

Use este template ao reportar problemas:

```markdown
## 🐛 Bug Report: [Nome da Feature]

### Descrição
[Uma linha descrevendo o problema]

### Passos para Reproduzir
1. [Passo 1]
2. [Passo 2]
3. [Passo 3]

### Esperado
[O que deveria acontecer]

### Obtido
[O que realmente acontece]

### Ambiente
- Local/Produção: [qual]
- Node: [version]
- PostgreSQL: [version]
- Browser: [qual, se UI]

### Análise Prévia (opcional)
- [ ] Verifiquei a API manualmente (curl)
- [ ] Verifiquei o banco (SELECT ...)
- [ ] Verifiquei os logs (DevTools, terminal)
- [ ] Identifiquei suspeita em: [arquivo]

### Skills a Executar
- [ ] /security-review (se envolver auth)
- [ ] /simplify (se parecer código complexo)
- [ ] Nenhum (just debug and fix)
```

---

## 🎯 Atalhos para Cada Tipo de Problema

| Problema | Arquivo | Skill |
|----------|---------|-------|
| API retorna erro | `src/app/api/.../route.ts` | `/security-review` |
| Use case quebrado | `src/features/.../use-cases/` | `/simplify` |
| Query SQL lenta | `src/features/.../repositories/` | `/simplify` |
| Auth não funciona | `src/lib/auth.ts`, `src/middleware.ts` | `/security-review` |
| UI não renderiza | `src/app/.../page.tsx` | Debugar com DevTools |
| Banco vazio | `src/shared/db/schema.ts` | Verificar migration |

---

## 💡 Dicas Extras

### 1. Use `docs/FEATURE_STRUCTURE.md`
Antes de pedir ajuda, use isto para **localizar a feature em 30 segundos**.

### 2. Teste a API Manualmente
```bash
# Ter certeza se o problema é na API ou na UI
curl -X GET http://localhost:3000/taximetro/api/case-records \
  -H "Cookie: authjs.session-token=TOKEN"
```

### 3. Teste o Banco Diretamente
```bash
psql postgresql://taximetro:taximetro_dev@localhost:5436/taximetro

# Listar ocorrências
SELECT * FROM case_records;

# Contar por intern
SELECT intern_id, COUNT(*) FROM case_records GROUP BY intern_id;
```

### 4. Use DevTools do Navegador
- **Network tab**: Ver request/response exata
- **Console**: Ver erros de JavaScript
- **Application tab**: Verificar cookies/localStorage

---

## 🔄 Exemplo Completo: Debug de Ocorrências

**Você relata:**
```
Ocorrências não estão sendo salvas.

Steps:
1. /intern/ocorrencias
2. Registrar "PCR"
3. Ver "Ocorrência registrada!" (sucesso)
4. Atualizar página
5. Ocorrência desapareceu

Banco (psql):
SELECT COUNT(*) FROM case_records;
→ 16 (não aumentou para 17)
```

**Eu faço:**

```bash
# 1. Localizar (30 seg)
# → docs/FEATURE_STRUCTURE.md → src/app/intern/ocorrencias/page.tsx
# → src/app/api/case-records/route.ts
# → src/features/case-records/application/use-cases/create-case-record.ts

# 2. Debugar a API (5 min)
curl -X POST http://localhost:3000/taximetro/api/case-records \
  -H "Content-Type: application/json" \
  -H "Cookie: authjs.session-token=REAL_TOKEN" \
  -d '{"assignmentId":"REAL_ID","nickname":"PCR"}'

# 3. Ver resposta
→ {"success":true,"data":{...}}  ← Então foi inserido!

# 4. Verificar banco com mesmo assignment
SELECT COUNT(*) FROM case_records WHERE assignment_id='REAL_ID';
→ 17  ← Então DEU CERTO!

# 5. Achar o verdadeiro problema
# A UI limpa o form com setForm({...form, nickname:"", description:""})
# Mas não recarrega a lista!
# A página só mostra ocorrências da requisição inicial
# Fix: Adicionar refetch ou setando lista manual
```

**Proposta**:
```typescript
// Em src/app/intern/ocorrencias/page.tsx
// Após sucesso, adicionar:
const newOccurrence = json.data;
setMsg({ type: "success", text: "Ocorrência registrada!" });
setForm({ ...form, nickname: "", description: "" });

// ← FALTA ISTO:
// Recarregar lista OU adicionar à lista existente
```

---

## ✅ Próxima Vez

Quando der problema:

1. **Descreva com detalhes** (use o template)
2. **Use `/` para skills** quando apropriado:
   - `/security-review` → problema de auth/permissão
   - `/simplify` → código complexo ou quebrado
3. **Dê contexto** (local vs prod, passos exatos, esperado vs obtido)
4. **Eu localizo rápido** (docs/FEATURE_STRUCTURE.md)
5. **Eu debugo rápido** (arquivo + linha específicos)
6. **Fix em minutos** (não horas)

---

**Criado para**: Acelerar troubleshooting de problemas como "ocorrências deram problema"  
**Tempo economizado**: De 2h para 10min  
**Chave**: Documentação + Skills + Detalhes
