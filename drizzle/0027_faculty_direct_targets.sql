-- Migration 0027: metas diretas por faculdade
--
-- A meta da faculdade passou a ser só isto: quantos USA, quantos CRU, quantos
-- CRL e quantas horas na rotação inteira. As metas semanais (target_*_per_week)
-- e a meta total avulsa (target_shifts) saíram de todo caminho de leitura do
-- código; as colunas continuam no banco porque o deploy roda
-- `drizzle-kit push --force` e derrubá-las apagaria o dado que este backfill lê.
--
-- Rode este arquivo ANTES ou DEPOIS do deploy — é idempotente e só preenche
-- meta total que ainda está zerada. Sem ele, quem só tinha meta semanal
-- configurada fica com meta zero e o coordenador precisa redigitar na tela
-- de Faculdades.

ALTER TABLE "faculties"
  ADD COLUMN IF NOT EXISTS "target_crls_total" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- Backfill: a rotação nominal era de 4 semanas — é assim que o seed de
-- produção derivava target_shifts (total = por semana × 4). Número de partida,
-- não verdade: a tela de Faculdades agora edita cada meta diretamente.
UPDATE "faculties"
   SET "target_usas_total" = "target_usas_per_week" * 4
 WHERE "target_usas_total" = 0 AND "target_usas_per_week" > 0;
--> statement-breakpoint
UPDATE "faculties"
   SET "target_crus_total" = "target_crus_per_week" * 4
 WHERE "target_crus_total" = 0 AND "target_crus_per_week" > 0;
--> statement-breakpoint
UPDATE "faculties"
   SET "target_crls_total" = "target_crls_per_week" * 4
 WHERE "target_crls_total" = 0 AND "target_crls_per_week" > 0;
