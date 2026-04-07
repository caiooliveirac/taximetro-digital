-- RN-01: Bloqueios de Grade (Pós-Graduação / Residência Médica)
ALTER TABLE slot_rules ADD COLUMN is_blocked boolean NOT NULL DEFAULT false;
ALTER TABLE slot_rules ADD COLUMN blocked_reason varchar(100);
ALTER TABLE slot_rules ADD COLUMN blocked_by uuid REFERENCES users(id);
ALTER TABLE slot_rules ADD COLUMN blocked_at timestamp;

-- RN-02: Plantão Extra
ALTER TABLE assignments ADD COLUMN is_extra_shift boolean NOT NULL DEFAULT false;
ALTER TABLE assignments ADD COLUMN extra_shift_notes text;
