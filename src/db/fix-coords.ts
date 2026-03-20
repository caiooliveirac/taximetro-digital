import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { bases } from "./schema";
import { eq } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://localhost:5432/taximetro";

/**
 * Atualiza coordenadas das bases com valores reais capturados no maps-samu.
 * Seguro para rodar em produção — só atualiza lat/lng/name, não remove dados.
 */
const REAL_COORDS: Record<string, { name: string; latitude: number; longitude: number }> = {
  SM01: { name: "Base San Martin",       latitude: -12.946836, longitude: -38.481288 },
  CB02: { name: "Base Cidade Baixa",     latitude: -12.935104, longitude: -38.506528 },
  PR03: { name: "Base Paralela",         latitude: -12.934140, longitude: -38.392223 },
  PM04: { name: "Base Pau Miúdo",        latitude: -12.959059, longitude: -38.487838 },
  BR05: { name: "Base Boca do Rio",      latitude: -12.983681, longitude: -38.438684 },
  CN10: { name: "Base Centenário",       latitude: -12.990816, longitude: -38.511382 },
  PP20: { name: "Base Periperi",         latitude: -12.868043, longitude: -38.472560 },
  IT30: { name: "Base Itapoã",           latitude: -12.924475, longitude: -38.351147 },
  PM40: { name: "Base Pau Miúdo (2)",    latitude: -12.959059, longitude: -38.487838 },
  CZ50: { name: "Base Cajazeiras",       latitude: -12.898305, longitude: -38.389943 },
  BR60: { name: "Base Boca do Rio (2)",  latitude: -12.983681, longitude: -38.438684 },
  CC70: { name: "Base Cabula",           latitude: -12.959085, longitude: -38.452476 },
};

async function fixCoords() {
  const client = postgres(DATABASE_URL);
  const db = drizzle(client);

  for (const [code, data] of Object.entries(REAL_COORDS)) {
    const [updated] = await db
      .update(bases)
      .set({ name: data.name, latitude: data.latitude, longitude: data.longitude })
      .where(eq(bases.code, code))
      .returning({ code: bases.code });

    if (updated) {
      console.log(`✅ ${code} → ${data.latitude}, ${data.longitude}`);
    } else {
      console.log(`⚠️  ${code} não encontrado no banco`);
    }
  }

  console.log("\n✅ Coordenadas atualizadas com dados reais do maps-samu!");
  await client.end();
}

fixCoords().catch((err) => {
  console.error("❌ Falha:", err);
  process.exit(1);
});
