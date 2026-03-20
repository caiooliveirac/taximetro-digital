/**
 * clean-dev.ts — Limpa TODOS os dados do banco e re-executa os seeds.
 *
 * Uso: npm run db:clean-dev
 *
 * Fluxo: DROP cascade → seed.ts → seed-dev.ts
 * NÃO executar em produção.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://localhost:5432/taximetro";

async function cleanDev() {
  const client = postgres(DATABASE_URL);
  const db = drizzle(client);

  console.log("🧹 Limpando banco de dados...\n");

  // Ordem respeitando foreign keys (filhos primeiro)
  const tables = [
    "password_reset_tokens",
    "qr_sessions",
    "audit_log",
    "case_records",
    "requests",
    "checkins",
    "assignments",
    "invite_links",
    "slot_rules",
    "telegram_bindings",
    "user_roles",
    "users",
    "bases",
    "faculties",
  ];

  for (const table of tables) {
    await db.execute(sql.raw(`DELETE FROM "${table}"`));
    console.log(`   ✓ ${table}`);
  }

  console.log("\n✅ Banco limpo. Rode agora:");
  console.log("   npm run db:demo");

  await client.end();
}

cleanDev().catch((err) => {
  console.error("❌ Limpeza falhou:", err);
  process.exit(1);
});
