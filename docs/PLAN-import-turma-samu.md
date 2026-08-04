# Plano — Importar turma UNIFACS do SAMU pra Vitalmed

Decisões já fechadas com Caio: endpoint HTTP interno no SAMU, duplicado vincula sem
recriar, senha reaproveita hash do SAMU, importa todos os papéis da turma (não só
interno).

## Fluxo

1. Admin Vitalmed abre `/admin/turmas`, clica "Importar do SAMU" numa turma UNIFACS.
2. Modal lista turmas UNIFACS do SAMU (via chamada server-to-server) pra escolher qual
   corresponde.
3. Confirma → Vitalmed chama SAMU, recebe os `user_roles` daquela turma, e por usuário:
   - acha existente no banco Vitalmed por CPF ou email → só cria `user_roles` novo
     (cohortId = turma Vitalmed, facultyId = UNIFACS da Vitalmed, baseId = null,
     role = igual ao do SAMU) se ainda não houver esse (userId, role, facultyId).
   - não existe → cria `users` novo com o mesmo `passwordHash`, `forcePasswordChange`
     mantém o valor do SAMU (se já tiver trocado lá, mantém trocada), depois o
     `user_roles`.
4. Devolve resumo: N criados, M vinculados (já existiam), erros por linha.

## Peças novas

**SAMU** (`src/app/api/internal/cohorts/`):
- `GET /taximetro/api/internal/cohorts?facultyAbbreviation=UNIFACS` — lista turmas
  UNIFACS (id, label, rotationNumber, startDate, endDate, status).
- `GET /taximetro/api/internal/cohorts/:id/roster` — devolve `user_roles` da turma com
  dados de `users` (name, cpf, email, phone, passwordHash, forcePasswordChange, role).
- Ambas exigem header `X-Import-Secret` batendo com env `CROSS_APP_IMPORT_SECRET`.
  Sem sessão de usuário — chamada servidor-a-servidor, não é rota pública de admin.

**Vitalmed**:
- Env novas: `SAMU_API_URL` (ex: `http://127.0.0.1:3000` — mesmo host, container SAMU
  já escuta em loopback), `CROSS_APP_IMPORT_SECRET` (mesmo valor nos dois containers).
- `GET /taximetro/api/admin/turmas/samu-cohorts` — proxy pra listar turmas UNIFACS do
  SAMU (pro dropdown do modal).
- `POST /taximetro/api/admin/turmas/:id/import-samu` — recebe `{ samuCohortId }`,
  busca roster no SAMU, faz o upsert descrito acima, devolve resumo.
- UI: botão "Importar do SAMU" na turma (só aparece se `faculty.abbreviation === "UNIFACS"`),
  modal com select de turma SAMU + botão confirmar + resumo do resultado.

## Fora do escopo agora

- Reimportar (turma já importada, veio gente nova no SAMU depois) — funciona porque o
  vínculo é idempotente (não recria duplicado), mas não tem UI de "sincronizar" — é só
  clicar de novo.
- Selfie do interno não é copiada (campo grande, opcional, sync separado se precisar).
- `baseId` fica null no vínculo novo — base é conceito local de cada instância, admin
  Vitalmed atribui depois.

## Deploy

Rota nova em produção nas duas instâncias. `CROSS_APP_IMPORT_SECRET` precisa existir
nos dois `.env` de produção antes do deploy funcionar — gerar valor e setar nos dois
hosts manualmente (não vai pro git). Aviso quando chegar nessa parte.
