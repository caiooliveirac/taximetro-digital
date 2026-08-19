-- Reverte abonos antigos que viraram presença sintética (CHECKED_OUT com
-- check-in/checkout fabricados pelo EXCUSE_ABSENCE). Identificados pelo audit
-- ABSENCE_EXCUSED + marca d'água do checkout sintético.
-- Rodar DEPOIS de 0024 (ADD VALUE precisa estar commitado antes do uso).

UPDATE assignments a
SET status = 'EXCUSED', updated_at = now()
WHERE a.status = 'CHECKED_OUT'
  AND EXISTS (
    SELECT 1 FROM audit_log l
    WHERE l.entity = 'assignment' AND l.entity_id = a.id AND l.action = 'ABSENCE_EXCUSED'
  )
  AND EXISTS (
    SELECT 1 FROM checkins c
    WHERE c.assignment_id = a.id AND c.checkout_notes = 'Falta abonada pela coordenação'
  );

UPDATE checkins c
SET status = 'REJECTED', validated_by = NULL, totp_validated_at = NULL,
    checkout_at = NULL, checkout_confirmed_by = NULL,
    checkout_notes = 'Presença sintética de abono revertida'
FROM assignments a
WHERE a.id = c.assignment_id
  AND a.status = 'EXCUSED'
  AND c.checkout_notes = 'Falta abonada pela coordenação';
