# 📊 Sistema de Relatórios de Presenças Diários

## ✅ O que foi implementado

### 1. **API de Relatórios** (`/api/report/daily-attendance-by-faculty`)
- Retorna dados de presenças agrupados por faculdade
- Período: últimos 30 dias
- Filtra apenas internos **não arquivados**
- Cada faculdade em ordem alfabética (AFYA, EBMSP, UFBA, UNIFACS, ZARNS)

**Exemplo de response:**
```json
{
  "success": true,
  "data": [
    {
      "facultyId": "uuid",
      "facultyAbbr": "EBMSP",
      "generatedAt": "2026-04-24T11:50:00Z",
      "interns": [
        {
          "internId": "uuid",
          "internName": "João Silva",
          "isArchived": false,
          "assignments": [
            {
              "assignmentId": "uuid",
              "date": "2026-04-24",
              "period": "DAY",
              "baseCode": "SM01",
              "baseName": "SAMU Central",
              "baseType": "USA",
              "status": "CHECKED_OUT",
              "checkinAt": "2026-04-24T08:15:00Z",
              "checkoutAt": "2026-04-24T17:45:00Z",
              "isJustified": true,
              "absenceJustification": null
            }
          ],
          "stats": {
            "totalUSAs": 2,
            "totalCheckedIn": 1,
            "totalCheckedOut": 1,
            "totalAbsent": 1,
            "totalAbsentJustified": 1,
            "totalAbsentNotJustified": 0,
            "totalScheduled": 0
          }
        }
      ]
    }
  ]
}
```

### 2. **Gerador de HTML** (`src/lib/attendance-report-html.ts`)
- Transforma dados JSON em relatórios HTML formatados
- **Design bonito** com:
  - Cores por faculdade (EBMSP 🟢, UFBA 🟠, UNIFACS 🟡, ZARNS 🔵, AFYA 🔴)
  - Emojis para períodos (☀️ Diurno, 🌙 Noturno)
  - Status visuais: ✓ Presente (verde), ❌ Ausente (vermelho), 📅 Agendado (amarelo)
  - Cards estatísticos: total de internos, plantões, presentes, ausências
  - Lista de plantões por interno com:
    - Data, base, período, turno
    - Check-in/check-out registrados
    - Ausências justificadas vs não justificadas
    - Observações de justificativa

### 3. **Integração com Backup Diário** (`scripts/daily-db-backup.mjs`)
- **Novo fluxo:**
  1. Cria backup do banco (pg_dump)
  2. **Gera relatórios** em HTML chamando `/api/report/daily-attendance-by-faculty`
  3. **Anexa relatórios** no email junto com dump + metadata
  4. Envia S3 (se configurado)

- **Anexos do email:**
  - `taximetro-TIMESTAMP.dump` (backup)
  - `taximetro-TIMESTAMP.dump.json` (metadata)
  - `relatorio-presencas-EBMSP.html` (um por faculdade)
  - `relatorio-presencas-UFBA.html`
  - etc.

- **Tratamento de erros:**
  - Se geração de relatórios falhar, backup continua
  - Se email falhar, S3 continua (ou vice-versa)
  - Tudo é registrado no metadata JSON

### 4. **Rota de Demonstração** (`/api/report/daily-attendance-by-faculty-demo`)
- Dados simulados para fins de teste
- Retorna exemplos com 2-3 internos por faculdade
- Útil para validar geração de HTML

## 🚀 Como usar

### Opção 1: Backup automático diário (recomendado)
**Já está configurado!**

O backup roda automaticamente todo dia às **3:37 AM (América/Bahia)** e:
1. Faz dump do banco
2. Gera relatórios de presenças
3. Envia email para `caio.olive94@gmail.com` com tudo anexado

Configuração no `.env`:
```env
DB_BACKUP_ENABLED=true
DB_BACKUP_CRON=37 3 * * *
DB_BACKUP_EMAIL_TO=caio.olive94@gmail.com
```

### Opção 2: Backup manual agora
```bash
docker exec taximetro-digital npm run db:backup
```

Relatórios + backup serão enviados imediatamente.

### Opção 3: Testar geração de HTML localmente
```bash
# Gera exemplos em /tmp/
APP_URL="http://localhost:3000" node scripts/test-attendance-reports.mjs
```

## 📋 Estrutura do Relatório HTML

Cada faculdade recebe um arquivo `.html` com:

```
┌─────────────────────────────────────┐
│ 🟢 EBMSP - Relatório de Presenças   │
│ Gerado em: 24/04/2026 11:50         │
└─────────────────────────────────────┘

┌─ ESTATÍSTICAS ─────────────────────┐
│ Internos: 8  │ Plantões: 42       │
│ Presentes: 38│ Ausências: 4       │
└────────────────────────────────────┘

┌─ JOÃO SILVA ──────────────────────────────┐
│ USA: 2 | Presentes: 1 | Ausências: 1     │
│                                           │
│ ☀️ 24/04 SM01 ✓ Finalizado (verde)      │
│   SAMU Central                           │
│   ✓ Check-in: 08:15 ✓ Check-out: 17:45  │
│                                           │
│ 🌙 23/04 CB02 ❌ Ausente (vermelho)      │
│   Ambulância 02                          │
│   ✓ Justificada: "Consulta médica"       │
└────────────────────────────────────────────┘

[... próximo interno ...]
```

## 🎨 Design & Emojis

### Cores por Faculdade
| Faculdade | Emoji | Cor | Uso |
|-----------|-------|-----|-----|
| EBMSP | 🟢 | Emerald | Verde clinicamente limpo |
| UFBA | 🟠 | Orange | Laranja institucional |
| UNIFACS | 🟡 | Yellow | Amarelo tradicional |
| ZARNS | 🔵 | Sky | Azul confiável |
| AFYA | 🔴 | Rose | Rosa médico |

### Status de Plantão
| Status | Emoji | Cor | Significado |
|--------|-------|-----|-------------|
| SCHEDULED | 📅 | Amber | Agendado, aguardando |
| CONFIRMED | ✅ | Green | Confirmado, pronto |
| CHECKED_IN | 🔵 | Blue | Em execução agora |
| CHECKED_OUT | ✓ | Green | Completado com sucesso |
| ABSENT | ❌ | Red | Faltou |
| CANCELLED | ⊘ | Gray | Cancelado |

### Períodos
| Período | Emoji |
|---------|-------|
| DAY | ☀️ |
| NIGHT | 🌙 |

## 📧 Email Recebido

**Assunto:**
```
[taximetro] Backup diario + Relatórios de Presenças
```

**Corpo:**
```
Taximetro Digital - backup diario do banco + relatórios de presenças

Backup:
  Arquivo: taximetro-20260424-085037.dump
  Tamanho: 11.8 MB
  Banco: taximetro @ host.docker.internal:5432
  Criado em: 2026-04-24T11:50:37.844Z
  Retenção local: 14 dia(s)

Relatórios de Presenças:
  5 faculdade(s) incluída(s)

O dump segue em anexo no formato custom do pg_dump (.dump).
Relatórios de presenças em HTML (um por faculdade).
Para restaurar backup: sh scripts/restore-db-backup.sh /caminho/do/arquivo.dump
```

**Anexos:**
- `taximetro-20260424-085037.dump` (11.8 MB)
- `taximetro-20260424-085037.dump.json` (1 KB)
- `relatorio-presencas-EBMSP.html`
- `relatorio-presencas-UFBA.html`
- `relatorio-presencas-UNIFACS.html`
- `relatorio-presencas-ZARNS.html`
- `relatorio-presencas-AFYA.html`

## 🔧 Configuração Avançada

### Habilitar S3 (opcional)
```env
DB_BACKUP_S3_ENABLED=true
DB_BACKUP_S3_BUCKET=seu-bucket
DB_BACKUP_S3_REGION=us-east-1
DB_BACKUP_S3_PREFIX=taximetro/backups
```

Relatórios também serão salvos em S3 (como metadata).

### Mudar hora do backup
```env
DB_BACKUP_CRON=0 2 * * *  # 2:00 AM
DB_BACKUP_TZ=America/Bahia
```

Formatos de cron suportados: `minute hour day month weekday`

### Alterar destinatários
```env
DB_BACKUP_EMAIL_TO=admin@example.com,backup@example.com
```

## 🎯 Próximas melhorias (opcional)

- [ ] Exportar relatórios como PDF com gráficos
- [ ] Dashboard de histórico de relatórios
- [ ] Filtros avançados por período, base, status
- [ ] Métricas agregadas (compliance rate, etc.)
- [ ] Alertas automáticos se muita ausência
- [ ] Integração com Slack/Telegram para notificações

## ✅ Validação

Tudo foi testado e validado:
- ✅ Sintaxe do script de backup OK
- ✅ TypeScript typecheck OK
- ✅ Backup executa com sucesso
- ✅ Email enviado com status "sent"
- ✅ Relatórios gerados em HTML
- ✅ Cores e emojis funcionando
- ✅ Integração com cron automática

**Próximo relatório em:** 25/04/2026 às 03:37 (America/Bahia) 📍

---

Desenvolvido: 2026-04-24
Status: ✅ Pronto para produção
