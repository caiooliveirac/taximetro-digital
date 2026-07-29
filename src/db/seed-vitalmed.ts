import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hash } from "bcryptjs";
import { bases, faculties, users, userRoles, slotRules } from "./schema";
import { eq } from "drizzle-orm";

/**
 * Seed da instância VITALMED (banco isolado, ver docs/vitalmed.md).
 *
 * Estrutura vinda da grade oficial "INTERNATO VITALMED":
 * - Viaturas (USA/VLA/VRR/VLP) → type "USA": entram na grade de viaturas,
 *   sorteio e regras de capacidade padrão (1 interno por turno).
 * - CCO (Central de Operações) → type "CENTRAL": herda o comportamento de
 *   regulação (troca exige autorização de preceptor, grade própria) e a meta
 *   "ir ao CCO 1x no estágio" fica em faculties.targetCRUsTotal.
 *
 * O schema não tem horário por unidade (janela operacional é global DAY/NIGHT),
 * então o horário de cada viatura fica registrado no name da base.
 */

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL não definido. Este seed nunca usa fallback de localhost.");
  process.exit(1);
}

// Coordenadas aproximadas dos postos em Salvador/BA — ajustar no admin
// (Cadastros → Bases) quando a Vitalmed confirmar os endereços exatos.
const LOCAIS = {
  EMPIRE: { latitude: -12.9797, longitude: -38.4576 }, // Empire Center, Caminho das Árvores
  IGUATEMI: { latitude: -12.9794, longitude: -38.4623 }, // região do Iguatemi/Shopping da Bahia
  CBX: { latitude: -12.9541, longitude: -38.5079 }, // placeholder (Comércio)
  ARENA: { latitude: -12.9789, longitude: -38.5043 }, // Arena Fonte Nova
  CATUSSABA: { latitude: -12.9411, longitude: -38.3323 }, // Catussaba, Stella Maris
} as const;

const GEOFENCE_PLACEHOLDER_METERS = 400;

const BASES_DATA = [
  { code: "CCO1", name: "CCO — Central de Operações · Empire Center (07h–19h)", type: "CENTRAL" as const, ...LOCAIS.EMPIRE },
  { code: "VLP221", name: "VLP 221 · Iguatemi (07h–19h)", type: "USA" as const, ...LOCAIS.IGUATEMI },
  { code: "USA101", name: "USA 101 · CBX (06h–18h)", type: "USA" as const, ...LOCAIS.CBX },
  { code: "USA121", name: "USA 121 · Arena (07h–19h)", type: "USA" as const, ...LOCAIS.ARENA },
  { code: "USA131", name: "USA 131 · Arena (08h–20h)", type: "USA" as const, ...LOCAIS.ARENA },
  { code: "USA151", name: "USA 151 · Iguatemi (07h–19h)", type: "USA" as const, ...LOCAIS.IGUATEMI },
  { code: "USA181", name: "USA 181 · Catussaba (07h–19h)", type: "USA" as const, ...LOCAIS.CATUSSABA },
  { code: "USA191", name: "USA 191 · Iguatemi (08h–20h)", type: "USA" as const, ...LOCAIS.IGUATEMI },
  { code: "VLA321", name: "VLA 321 · Iguatemi (07h–19h)", type: "USA" as const, ...LOCAIS.IGUATEMI },
  { code: "VLA341", name: "VLA 341 · Iguatemi (08h–20h)", type: "USA" as const, ...LOCAIS.IGUATEMI },
  { code: "VLA351", name: "VLA 351 · Catussaba (09h–21h)", type: "USA" as const, ...LOCAIS.CATUSSABA },
  { code: "VLA361", name: "VLA 361 · Iguatemi (06h–18h)", type: "USA" as const, ...LOCAIS.IGUATEMI },
  { code: "VRR551", name: "VRR 551 · Iguatemi (06h–18h)", type: "USA" as const, ...LOCAIS.IGUATEMI },
  { code: "VRR552", name: "VRR 552 · CBX (08h–20h)", type: "USA" as const, ...LOCAIS.CBX },
  { code: "VRR553", name: "VRR 553 · Iguatemi (10h–22h)", type: "USA" as const, ...LOCAIS.IGUATEMI },
].map((base) => ({ ...base, geoFenceMeters: GEOFENCE_PLACEHOLDER_METERS }));

// UNIFACS: 6 semanas × 1 plantão de 12h/semana = 6 plantões / 72h, sendo 1 no CCO.
// EBMSP roda menos semanas com mais intensidade — metas iniciais iguais às da
// UNIFACS; ajustar em Admin → Faculdades quando a Vitalmed confirmar a carga.
const FACULTIES_DATA = [
  {
    name: "UNIFACS",
    abbreviation: "UNIFACS",
    targetHours: 72,
    targetShifts: 6,
    targetUSAsPerWeek: 1,
    targetUSAsTotal: 5,
    targetCRUsTotal: 1,
  },
  {
    name: "EBMSP",
    abbreviation: "EBMSP",
    targetHours: 72,
    targetShifts: 6,
    targetUSAsPerWeek: 1,
    targetUSAsTotal: 5,
    targetCRUsTotal: 1,
  },
];

const WEEK_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

async function seed() {
  const client = postgres(DATABASE_URL!);
  const db = drizzle(client);

  console.log("🌱 Seed Vitalmed: inserindo unidades (bases)...");
  await db.insert(bases).values(BASES_DATA).onConflictDoNothing();

  console.log("🌱 Seed Vitalmed: inserindo faculdades...");
  await db.insert(faculties).values(FACULTIES_DATA).onConflictDoNothing();

  console.log("🌱 Seed Vitalmed: criando usuário administrador...");
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
  const forcePasswordChange = process.env.SEED_ADMIN_FORCE_CHANGE === "1";
  const passwordHash = await hash(adminPassword, 12);

  const [admin] = await db
    .insert(users)
    .values({
      name: "Caio Oliveira",
      cpf: "000.000.000-00",
      email: "caio.olive94@gmail.com",
      passwordHash,
      forcePasswordChange,
    })
    .onConflictDoNothing()
    .returning({ id: users.id });

  const adminId =
    admin?.id ??
    (await db.select({ id: users.id }).from(users).where(eq(users.email, "caio.olive94@gmail.com")))[0]?.id;

  if (adminId) {
    await db.insert(userRoles).values({ userId: adminId, role: "COORDINATOR" }).onConflictDoNothing();

    const existingRoles = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, adminId));
    if (!existingRoles.some((row) => row.role === "PRECEPTOR")) {
      await db.insert(userRoles).values({ userId: adminId, role: "PRECEPTOR" });
    }
  }

  console.log("🌱 Seed Vitalmed: inserindo regras de vaga (1 interno por viatura/turno)...");
  const allBases = await db.select({ id: bases.id, code: bases.code }).from(bases);
  const allFaculties = await db.select({ id: faculties.id, abbreviation: faculties.abbreviation }).from(faculties);
  const seededCodes = new Set(BASES_DATA.map((b) => b.code));

  let ruleCount = 0;
  for (const base of allBases) {
    if (!seededCodes.has(base.code)) continue;
    for (const day of WEEK_DAYS) {
      for (const faculty of allFaculties) {
        await db
          .insert(slotRules)
          .values({ baseId: base.id, dayOfWeek: day, period: "DAY", facultyId: faculty.id, capacity: 1 })
          .onConflictDoNothing();
        ruleCount += 1;
      }
    }
  }
  console.log(`   ${ruleCount} regras processadas (turno DAY, capacidade 1).`);

  console.log("✅ Seed Vitalmed concluído!");
  await client.end();
}

seed().catch((err) => {
  console.error("❌ Seed Vitalmed falhou:", err);
  process.exit(1);
});
