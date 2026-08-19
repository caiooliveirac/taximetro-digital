-- Falta abonada deixa de virar presença sintética: ganha status próprio.
ALTER TYPE "assignment_status" ADD VALUE IF NOT EXISTS 'EXCUSED';
