-- Suporte a "limpar do alerta" para faltas no cockpit /admin.
-- Coordenador pode dispensar uma falta do card de alerta sem
-- precisar cancelar o plantão (que sumiria do banco para fins de
-- relatório). Falta permanece com status='ABSENT', mas com
-- absence_alert_dismissed_at preenchido o cockpit não lista.
-- Reverter: DROP COLUMN nas duas (idempotente, não quebra dados).

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS absence_alert_dismissed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS absence_alert_dismissed_by UUID REFERENCES users(id);

-- Índice partial para a query do cockpit ficar enxuta —
-- só plantões ABSENT pendentes de revisão pelo coordenador.
CREATE INDEX IF NOT EXISTS idx_assignment_absence_pending
  ON assignments(date)
  WHERE status = 'ABSENT'
    AND absence_alert_dismissed_at IS NULL
    AND is_extra_shift = false;
