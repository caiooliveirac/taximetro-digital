-- Migration 0031: mensagens entre internos (chat para combinar troca)
-- Aplicada pelo `drizzle-kit push` do deploy (apply_db_changes). Registro.
-- Ver src/app/api/intern/mensagens/route.ts.

CREATE TABLE IF NOT EXISTS "intern_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "from_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "to_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "request_id" uuid REFERENCES "requests"("id"),
  "body" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "read_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_intern_messages_to_unread" ON "intern_messages" ("to_user_id", "read_at");
CREATE INDEX IF NOT EXISTS "idx_intern_messages_pair" ON "intern_messages" ("from_user_id", "to_user_id", "created_at");
