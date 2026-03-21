import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hash } from "bcryptjs";
import { bases, faculties, users, userRoles } from "./schema";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://localhost:5432/taximetro";

async function seed() {
  const client = postgres(DATABASE_URL);
  const db = drizzle(client);

  console.log("🌱 Seed: inserindo bases...");
  // Coordenadas reais capturadas no maps-samu (tiles CARTO/OSM)
  const BASES_DATA = [
    { code: "SM01", name: "Base San Martin",       type: "USA"     as const, latitude: -12.946836, longitude: -38.481288 },
    { code: "CB02", name: "Base Cidade Baixa",      type: "USA"     as const, latitude: -12.935104, longitude: -38.506528 },
    { code: "PR03", name: "Base Paralela",          type: "USA"     as const, latitude: -12.934140, longitude: -38.392223 },
    { code: "PM04", name: "Base Pau Miúdo",         type: "USA"     as const, latitude: -12.959059, longitude: -38.487838 },
    { code: "BR05", name: "Base Boca do Rio",       type: "USA"     as const, latitude: -12.983681, longitude: -38.438684 },
    { code: "CN10", name: "Base Centenário",        type: "USA"     as const, latitude: -12.990816, longitude: -38.511382 },
    { code: "PP20", name: "Base Periperi",          type: "USA"     as const, latitude: -12.868043, longitude: -38.472560 },
    { code: "IT30", name: "Base Itapoã",            type: "USA"     as const, latitude: -12.924475, longitude: -38.351147 },
    { code: "PM40", name: "Base Pau Miúdo (2)",     type: "USA"     as const, latitude: -12.959059, longitude: -38.487838 },
    { code: "CZ50", name: "Base Cajazeiras",        type: "USA"     as const, latitude: -12.898305, longitude: -38.389943 },
    { code: "BR60", name: "Base Boca do Rio (2)",   type: "USA"     as const, latitude: -12.983681, longitude: -38.438684 },
    { code: "CC70", name: "Base Cabula",            type: "USA"     as const, latitude: -12.959085, longitude: -38.452476 },
    { code: "CRU",  name: "Central de Regulação",   type: "CENTRAL" as const, latitude: -12.971100, longitude: -38.511600 },
  ];

  await db.insert(bases).values(BASES_DATA).onConflictDoNothing();

  console.log("🌱 Seed: inserindo faculdades...");
  const FACULTIES_DATA = [
    { name: "ZARNS",   abbreviation: "ZARNS" },
    { name: "UFBA",    abbreviation: "UFBA" },
    { name: "AFYA",    abbreviation: "AFYA" },
    { name: "UNIFACS", abbreviation: "UNIFACS" },
    { name: "EBMSP",   abbreviation: "EBMSP" },
  ];

  await db.insert(faculties).values(FACULTIES_DATA).onConflictDoNothing();

  console.log("🌱 Seed: criando usuário administrador...");
  const passwordHash = await hash("admin123", 12);

  const [admin] = await db
    .insert(users)
    .values({
      name: "Caio Oliveira",
      cpf: "000.000.000-00",
      email: "caio.olive94@gmail.com",
      passwordHash,
    })
    .onConflictDoNothing()
    .returning({ id: users.id });

  if (admin) {
    await db
      .insert(userRoles)
      .values({
        userId: admin.id,
        role: "COORDINATOR",
      })
      .onConflictDoNothing();
  }

  console.log("✅ Seed concluído!");
  await client.end();
}

seed().catch((err) => {
  console.error("❌ Seed falhou:", err);
  process.exit(1);
});
