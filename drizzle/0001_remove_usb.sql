-- Migration: Remove USB base type (all USB bases are actually USA)
-- 1. Update all existing USB bases to USA
UPDATE bases SET type = 'USA' WHERE type = 'USB';

-- 2. Remove USB from the enum
ALTER TYPE base_type RENAME TO base_type_old;
CREATE TYPE base_type AS ENUM ('USA', 'CENTRAL');
ALTER TABLE bases ALTER COLUMN type TYPE base_type USING type::text::base_type;
DROP TYPE base_type_old;
