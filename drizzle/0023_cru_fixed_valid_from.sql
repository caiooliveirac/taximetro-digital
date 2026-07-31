-- Início da vigência do CRU fixo. A tabela só guardava valid_until, então não
-- havia como saber quando o rodízio começou — informação que a cota de troca de
-- CRU (uma por interno por rodízio) precisa para saber o que contar.
-- Backfill: 6 semanas para trás a partir de valid_until, que é a duração usada
-- na prática. Rodízio de outra duração fica com a janela torta até a próxima
-- renovação, que grava o valor certo.
-- Reverter: DROP COLUMN (idempotente, não quebra dados).

ALTER TABLE cru_fixed_assignments
  ADD COLUMN IF NOT EXISTS valid_from DATE;

UPDATE cru_fixed_assignments
  SET valid_from = valid_until - INTERVAL '41 days'
  WHERE valid_from IS NULL;

ALTER TABLE cru_fixed_assignments
  ALTER COLUMN valid_from SET NOT NULL;
