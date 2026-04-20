/**
 * seed-prod.ts — Seed de produção/demo realista (v2 — rico).
 *
 * 60 internos (12 por faculdade), 20 preceptores, escalas cobrindo quase tudo.
 * Todos os nomes são únicos (sem homônimos).
 *
 * Uso:
 *   DATABASE_URL=... npx tsx src/db/seed-prod.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hash } from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import {
  bases, faculties, users, userRoles, slotRules,
  assignments, checkins, requests, caseRecords, auditLog,
} from "./schema";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/taximetro";

// ── Nomes únicos (60 internos, 20 preceptores) ──────────────────

const INTERN_NAMES = [
  // ZARNS (12)
  "Mariana Silva Rêgo", "Lucas Prado Bonfim", "Beatriz Cerqueira Dantas",
  "Gustavo Lacerda Paranhos", "Fernanda Couto Vilaça", "André Bulcão Teles",
  "Isabela Pitanga Maciel", "Thiago Dourado Assis", "Carolina Argôlo Souza",
  "Leonardo Guimarães Spínola", "Raquel Barreto Luz", "Felipe Alcântara Neves",
  // UFBA (12)
  "Amanda Brandão Pacheco", "Pedro Mascarenhas Lago", "Júlia Sena Veloso",
  "Rafael Daltro Carneiro", "Camila Figueiredo Leal", "Bruno Tavares Magalhães",
  "Letícia Coutinho Athayde", "Diego Paranaguá Fontes", "Bruna Valença Gondim",
  "Vinícius Braga Tourinho", "Natália Cavalcanti Lima", "Arthur Bacelar Motta",
  // AFYA (12)
  "Patrícia Rabelo Duarte", "Henrique Gordilho Carmo", "Larissa Rebouças Farias",
  "Matheus Brandão Souto", "Sofia Garcez Pitta", "Caio Lordelo Ribas",
  "Helena Canário Vasconcelos", "Gabriel Muniz Bandeira", "Laura Sampaio Galvão",
  "Eduardo Paranhos Velame", "Tainá Lordelo Cedraz", "Conrado Sepúlveda Ramos",
  // UNIFACS (12)
  "Renata Bittencourt Bastos", "Tomás Portela Seabra", "Débora Fróes Queiroz",
  "Samuel Studart Pimenta", "Marília Cedraz Borges", "Otávio Wanderley Falcão",
  "Luana Calmon Menezes", "Rodrigo Baleeiro Trindade", "Aline Bispo Sampaio",
  "Fábio Monteiro Caldas", "Joana Vitória Tosta", "Enzo Pragana Lessa",
  // EBMSP (12)
  "Clara Augusta Pimentel", "Marcelo Valente Simas", "Lívia Guedes Saback",
  "Caetano Magnavita Brito", "Marina Tourinho Pedreira", "Igor Habib Mello",
  "Heloísa Sapucaia Rocha", "Danilo Gandra Bezerra", "Bianca Fonseca Didier",
  "Vicente Lobo Dórea", "Alice Bulhões Arouca", "Rogério Maia Espinheira",
];

const PREC_NAMES = [
  "Dra. Preceptora 07", "Dr. Preceptor 06", "Dra. Preceptora 04",
  "Dr. Preceptor 03", "Dra. Preceptora 08", "Dr. Preceptor 07",
  "Dra. Preceptora 05", "Dr. Preceptor 04", "Dra. Preceptora 02",
  "Dr. Preceptor 01", "Dra. Preceptora 01", "Dr. Preceptor 10",
  "Dra. Preceptora 06", "Dr. Preceptor 08", "Dra. Preceptora 10",
  "Dr. Preceptor 05", "Dra. Preceptora 09", "Dr. Preceptor 09",
  "Dra. Preceptora 03", "Dr. Preceptor 02",
];

const PHONE_PREFIX = ["71", "73", "75", "77"];

const BASE_RANK = [
  "SM01", "PM04", "PM40", "CN10", "PR03", "CC70",
  "BR60", "CB02", "IT30", "CZ50", "BR05", "PP20",
];
const NIGHT_SET = new Set(BASE_RANK.slice(0, 6));
const FAC_ABBR = ["ZARNS", "UFBA", "AFYA", "UNIFACS", "EBMSP"] as const;
const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

const CASE_SCENARIOS = [
  { nickname: "PCR — Fibrilação Ventricular", description: "Masculino, 58a, PCR em via pública. Ritmo FV. DEA 1 choque + RCP 2 min. RCE após 4 min." },
  { nickname: "Trauma Cranioencefálico", description: "Queda de moto sem capacete, masculino 23a. GCS 9. Anisocoria D>E. Imobilização cervical." },
  { nickname: "Crise Hipertensiva", description: "Feminina, 72a, PA 220x130mmHg, cefaleia intensa. Captopril 25mg SL. PA controle 180x100." },
  { nickname: "Dispneia — EAP", description: "Masculino 65a, dispneia súbita, crepitações bilaterais. SpO2 82%. Furosemida 40mg EV." },
  { nickname: "IAM com Supra ST", description: "Masculino 62a, dor torácica 40 min. Supra V1-V4. AAS+Clopidogrel. Hemodinâmica ativada." },
  { nickname: "Convulsão Febril", description: "Criança 2a, convulsão tônico-clônica 3 min. T 39.8C. Diazepam retal 5mg. Cessou crise." },
  { nickname: "Hipoglicemia Grave", description: "Masculino 45a, DM2, glicemia 28 mg/dL, torpor. Glicose 50% 40mL EV. Recuperou consciência." },
  { nickname: "AVE Isquêmico", description: "Feminina 68a, hemiparesia E súbita + disartria. FAST positivo. Onset 45 min. Ativação stroke." },
  { nickname: "Crise Asmática Grave", description: "Feminina 19a, dispneia, FC 130, SpO2 88%, MV reduzido bilat. Salbutamol + ipratrópio NBZ." },
  { nickname: "Queimadura 2° grau", description: "Masculino 34a, queimadura por líquido quente em tronco anterior ~18% SCQ. Acesso venoso." },
  { nickname: "Parto em Trânsito", description: "Feminina 28a, G2P1, dilatação total, expulsivo. Parto cefálico normal, Apgar 8/10." },
  { nickname: "Intoxicação Exógena", description: "Feminina 22a, ingestão de carbamato. Sialorréia, miose, bradicardia. Atropina 1mg EV." },
  { nickname: "Fratura Exposta Tíbia", description: "Masculino 30a, acidente moto. Fratura exposta tíbia D, Gustilo II. Curativo + tala + analgesia." },
  { nickname: "Choque Anafilático", description: "Feminina 15a, pós-picada abelha. Urticária + broncoespasmo + hipotensão. Adrenalina IM." },
  { nickname: "Afogamento", description: "Masculino 12a, submersão ~3 min. Consciente, tossindo, SpO2 91%. O2 suplementar. HGE." },
];

// ── Helpers ──────────────────────────────────────────────────────

function dateStr(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function stripAccents(s: string) { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function fakeCPF(n: number): string {
  const s = n.toString().padStart(11, "0");
  return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9, 11)}`;
}
function fakePhone(n: number): string {
  const prefix = PHONE_PREFIX[n % PHONE_PREFIX.length];
  const num = (99000000 + n * 1117).toString().slice(0, 9);
  return `(${prefix}) ${num.slice(0, 5)}-${num.slice(5)}`;
}

// Deterministic PRNG
let _rng = 7;
function rng() { _rng = (_rng * 1103515245 + 12345) & 0x7fffffff; return _rng / 0x7fffffff; }

function slotPair(baseRank: number, dayIdx: number, isNight: boolean): [number, number] {
  const s = (baseRank * 2 + dayIdx * 2 + (isNight ? 2 : 0)) % 5;
  return [s, (s + 1) % 5];
}

// ─────────────────────────────────────────────────────────────────

async function seedProd() {
  const client = postgres(DATABASE_URL);
  const db = drizzle(client);
  const pw = await hash("demo123", 12);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // 1. Verify base seed
  console.log("🔍 Verificando seed base...");
  const allBases = await db.select().from(bases);
  const allFac = await db.select().from(faculties);
  if (!allBases.length || !allFac.length) {
    console.error("❌ Execute seed base primeiro: npm run db:seed");
    await client.end(); process.exit(1);
  }
  const baseByCode = Object.fromEntries(allBases.map(b => [b.code, b])) as Record<string, typeof allBases[0]>;
  const facByAbbr = Object.fromEntries(allFac.map(f => [f.abbreviation, f])) as Record<string, typeof allFac[0]>;
  const facIds = FAC_ABBR.map(a => facByAbbr[a].id);
  const cruBase = allBases.find(b => b.type === "CENTRAL")!;
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.email, "caio.olive94@gmail.com"));
  const coordId = admin!.id;

  // 2. Faculty targets (segmented by base type: USA/CRU/CRL)
  console.log("🎯 Atualizando metas por tipo de base...");
  const targets: Record<string, { usas: number; crus: number; crls: number; hours: number; total: number }> = {
    ZARNS: { usas: 2, crus: 2, crls: 2, hours: 240, total: 6 },     // 2+2+2 = 6 por semana (12h each)
    UFBA: { usas: 2, crus: 2, crls: 1, hours: 240, total: 5 },      // 2+2+1 = 5 por semana (12h each)
    AFYA: { usas: 2, crus: 2, crls: 2, hours: 240, total: 6 },      // 2+2+2 = 6 por semana (12h each)
    UNIFACS: { usas: 1, crus: 2, crls: 2, hours: 240, total: 5 },   // 1+2+2 = 5 por semana (12h each)
    EBMSP: { usas: 0, crus: 8, crls: 0, hours: 240, total: 8 },     // 0+8+0 = 8 por semana (6h each turno)
  };
  
  for (const abbr of FAC_ABBR) {
    const t = targets[abbr];
    await db.update(faculties).set({
      targetHours: t.hours, targetShifts: t.total * 4, // ~4 semanas por mês
      targetShiftsPerWeek: t.total, // backward compat
      targetUSAsPerWeek: t.usas,
      targetCRUsPerWeek: t.crus,
      targetCRLsPerWeek: t.crls,
      totalInterns: 12,
    }).where(eq(faculties.id, facByAbbr[abbr].id));
  }

  // 3. Preceptors (20 — distributed across bases)
  console.log("👤 Criando 20 preceptores...");
  const orderedBaseCodes = [...BASE_RANK, "CRU"];
  const precIds: string[] = [];
  const precByBase: Record<string, string> = {};

  for (let i = 0; i < 20; i++) {
    const cpf = fakeCPF(i + 1);
    const emailPrefix = stripAccents(PREC_NAMES[i].replace(/^(Dra?\.\s)/, "").split(" ")[0].toLowerCase());
    const [created] = await db.insert(users).values({
      name: PREC_NAMES[i], cpf, email: `${emailPrefix}.prec${i + 1}@demo.dev`,
      phone: fakePhone(900 + i), passwordHash: pw,
    }).onConflictDoNothing().returning({ id: users.id });
    const id = created?.id ?? (await db.select({ id: users.id }).from(users).where(eq(users.cpf, cpf)))[0].id;
    const base = baseByCode[orderedBaseCodes[i % orderedBaseCodes.length]] ?? cruBase;
    await db.insert(userRoles).values({ userId: id, role: "PRECEPTOR", baseId: base.id }).onConflictDoNothing();
    precIds.push(id);
    if (!precByBase[base.id]) precByBase[base.id] = id;
  }

  // 4. Interns: 5 x 12 = 60 (1 LEADER+INTERN per faculty, 11 pure INTERN)
  console.log("👤 Criando 60 internos (5 com duplo LEADER+INTERN)...");

  type MemberInfo = { name: string; cpf: string; email: string; phone: string; facIdx: number; pos: number };
  const memberData: MemberInfo[] = [];
  let cpfCounter = 100;

  for (let f = 0; f < 5; f++) {
    for (let u = 0; u < 12; u++) {
      const globalIdx = f * 12 + u;
      const name = INTERN_NAMES[globalIdx];
      const emailPrefix = stripAccents(name.split(" ")[0].toLowerCase());
      memberData.push({
        name,
        cpf: fakeCPF(cpfCounter++),
        email: `${emailPrefix}.${FAC_ABBR[f].toLowerCase()}${u}@demo.dev`,
        phone: fakePhone(cpfCounter),
        facIdx: f,
        pos: u,
      });
    }
  }

  await db.insert(users).values(
    memberData.map(m => ({ name: m.name, cpf: m.cpf, email: m.email, phone: m.phone, passwordHash: pw })),
  ).onConflictDoNothing();

  const allCreated = await db.select({ id: users.id, cpf: users.cpf })
    .from(users)
    .where(inArray(users.cpf, memberData.map(m => m.cpf)));
  const cpfToId = new Map(allCreated.map(r => [r.cpf, r.id]));

  const roleRows: { userId: string; role: "LEADER" | "INTERN"; facultyId: string }[] = [];
  const facInternIds: string[][] = [[], [], [], [], []];

  for (const m of memberData) {
    const userId = cpfToId.get(m.cpf)!;
    facInternIds[m.facIdx].push(userId);
    if (m.pos === 0) {
      roleRows.push({ userId, role: "LEADER", facultyId: facIds[m.facIdx] });
    }
    roleRows.push({ userId, role: "INTERN", facultyId: facIds[m.facIdx] });
  }

  await db.insert(userRoles).values(roleRows).onConflictDoNothing();
  console.log(`   -> ${allCreated.length} usuarios, ${roleRows.length} roles`);

  // 5. Slot rules — 2 vagas por turno por base (dense coverage)
  console.log("📋 Criando regras de vagas...");

  type SRow = { baseId: string; dayOfWeek: typeof DOW[number]; period: "DAY" | "NIGHT"; facultyId: string; capacity: number };
  const slotRows: SRow[] = [];

  for (let r = 0; r < BASE_RANK.length; r++) {
    const base = baseByCode[BASE_RANK[r]]; if (!base) continue;
    for (let d = 0; d < 7; d++) {
      const [da, dbb] = slotPair(r, d, false);
      slotRows.push({ baseId: base.id, dayOfWeek: DOW[d], period: "DAY", facultyId: facIds[da], capacity: 1 });
      slotRows.push({ baseId: base.id, dayOfWeek: DOW[d], period: "DAY", facultyId: facIds[dbb], capacity: 1 });
      if (NIGHT_SET.has(BASE_RANK[r])) {
        const [na, nb] = slotPair(r, d, true);
        slotRows.push({ baseId: base.id, dayOfWeek: DOW[d], period: "NIGHT", facultyId: facIds[na], capacity: 1 });
        slotRows.push({ baseId: base.id, dayOfWeek: DOW[d], period: "NIGHT", facultyId: facIds[nb], capacity: 1 });
      }
    }
  }

  // CRU gets 3 slots during day (more faculties)
  for (let d = 0; d < 7; d++) {
    const [ca, cb] = slotPair(12, d, false);
    const cc = (ca + 2) % 5;
    slotRows.push({ baseId: cruBase.id, dayOfWeek: DOW[d], period: "DAY", facultyId: facIds[ca], capacity: 1 });
    slotRows.push({ baseId: cruBase.id, dayOfWeek: DOW[d], period: "DAY", facultyId: facIds[cb], capacity: 1 });
    slotRows.push({ baseId: cruBase.id, dayOfWeek: DOW[d], period: "DAY", facultyId: facIds[cc], capacity: 1 });
  }

  for (let i = 0; i < slotRows.length; i += 200) {
    await db.insert(slotRules).values(slotRows.slice(i, i + 200)).onConflictDoNothing();
  }
  console.log(`   -> ${slotRows.length} regras de vagas`);

  // 6. Pre-compute positions per faculty per day-of-week
  type Pos = { baseId: string; baseCode: string; period: "DAY" | "NIGHT" };
  const facPos: Pos[][][] = [];

  for (let f = 0; f < 5; f++) {
    facPos[f] = [];
    for (let d = 0; d < 7; d++) {
      const pos: Pos[] = [];
      for (let r = 0; r < BASE_RANK.length; r++) {
        const base = baseByCode[BASE_RANK[r]]; if (!base) continue;
        const [da, dbb] = slotPair(r, d, false);
        if (da === f || dbb === f) pos.push({ baseId: base.id, baseCode: BASE_RANK[r], period: "DAY" });
        if (NIGHT_SET.has(BASE_RANK[r])) {
          const [na, nb] = slotPair(r, d, true);
          if (na === f || nb === f) pos.push({ baseId: base.id, baseCode: BASE_RANK[r], period: "NIGHT" });
        }
      }
      const [ca, cb] = slotPair(12, d, false);
      const cc = (ca + 2) % 5;
      if (ca === f || cb === f || cc === f) pos.push({ baseId: cruBase.id, baseCode: "CRU", period: "DAY" });
      facPos[f][d] = pos;
    }
  }

  // 7. Generate assignments (-7 to +7)
  console.log("📅 Gerando atribuicoes (-7 a +7)...");

  type ARow = {
    internId: string; facultyId: string; baseId: string;
    date: string; period: "DAY" | "NIGHT"; status: string; createdBy: string;
  };
  const allRows: ARow[] = [];
  const booked = new Set<string>();

  for (let dayOff = -7; dayOff <= 7; dayOff++) {
    const d = addDays(today, dayOff);
    const dIdx = (d.getDay() + 6) % 7;
    const dStr = dateStr(d);

    for (let f = 0; f < 5; f++) {
      const positions = facPos[f][dIdx];
      const interns = facInternIds[f];
      const start = Math.abs(dayOff * 3 + f * 7) % interns.length;
      let ptr = start;

      for (let pi = 0; pi < positions.length; pi++) {
        const pos = positions[pi];
        for (let a = 0; a < interns.length; a++) {
          const iid = interns[(ptr + a) % interns.length];
          const key = `${iid}|${dStr}|${pos.period}`;
          if (!booked.has(key)) {
            booked.add(key);
            let status: string;
            if (dayOff < 0) {
              status = ((Math.abs(dayOff) * 7 + f * 3 + pi) % 12 === 0) ? "ABSENT" : "CHECKED_OUT";
            } else if (dayOff === 0) {
              const roll = (f * 5 + pi) % 6;
              status = roll < 4 ? "CHECKED_IN" : roll === 4 ? "SCHEDULED" : "ABSENT";
            } else {
              status = "SCHEDULED";
            }
            allRows.push({
              internId: iid, facultyId: facIds[f], baseId: pos.baseId,
              date: dStr, period: pos.period, status, createdBy: coordId,
            });
            ptr = (ptr + a + 1) % interns.length;
            break;
          }
        }
      }
    }
  }

  type InsertedA = {
    id: string; internId: string; date: string; baseId: string;
    period: string; status: string; facultyId: string;
  };
  const insertedAll: InsertedA[] = [];

  for (let i = 0; i < allRows.length; i += 200) {
    const chunk = allRows.slice(i, i + 200);
    const created = await db.insert(assignments)
      .values(chunk.map(r => ({ ...r, status: r.status as "SCHEDULED" })))
      .onConflictDoNothing()
      .returning({
        id: assignments.id, internId: assignments.internId, date: assignments.date,
        baseId: assignments.baseId, period: assignments.period, status: assignments.status,
        facultyId: assignments.facultyId,
      });
    insertedAll.push(...created);
  }

  const todayStr = dateStr(today);
  const historyA = insertedAll.filter(a => a.date < todayStr);
  const todayA = insertedAll.filter(a => a.date === todayStr);
  const futureA = insertedAll.filter(a => a.date > todayStr);
  console.log(`   -> ${historyA.length} passados, ${todayA.length} hoje, ${futureA.length} futuros`);

  // 8. Check-ins — com problemas realistas
  console.log("✅ Criando check-ins (com erros Geo/TOTP/atrasos)...");
  const needCheckin = insertedAll.filter(a => a.status === "CHECKED_OUT" || a.status === "CHECKED_IN");

  type CRow = {
    assignmentId: string; internId: string;
    checkinLat: number | null; checkinLng: number | null;
    geoDistanceMeters: number | null; geoValid: boolean | null;
    checkinAt: Date | null; totpSecret: string | null;
    totpValidatedAt: Date | null; validatedBy: string | null;
    method: "TELEGRAM_CODE" | "APP_DIRECT" | null;
    status: "VALIDATED" | "EXPIRED" | "PENDING";
    checkoutAt: Date | null; checkoutConfirmedBy: string | null;
    checkoutNotes: string | null;
  };
  const cRows: CRow[] = [];

  let geoErrorCount = 0;
  let totpExpiredCount = 0;
  let lateCount = 0;

  for (let ci = 0; ci < needCheckin.length; ci++) {
    const a = needCheckin[ci];
    const base = allBases.find(b => b.id === a.baseId)!;
    const aDate = new Date(a.date + "T12:00:00");
    const prec = precByBase[a.baseId] ?? precIds[0];
    const isToday = a.date === todayStr;

    const roll = rng();
    const hasGeoError = roll < 0.12;
    const hasTotpExpired = !hasGeoError && roll < 0.20;
    const isLate = !hasGeoError && !hasTotpExpired && roll < 0.30;

    let cHour: number;
    let cMinute: number;
    if (a.period === "DAY") {
      cHour = isLate ? 7 + Math.floor(rng() * 2) : 6 + Math.floor(rng() * 1);
      cMinute = isLate ? 30 + Math.floor(rng() * 25) : Math.floor(rng() * 30);
    } else {
      cHour = isLate ? 19 + Math.floor(rng() * 2) : 18 + Math.floor(rng() * 1);
      cMinute = isLate ? 30 + Math.floor(rng() * 25) : Math.floor(rng() * 30);
    }
    const cTime = new Date(aDate);
    cTime.setHours(cHour, cMinute, 0);

    let lat: number;
    let lng: number;
    let geoDist: number;
    let geoValid: boolean;

    if (hasGeoError) {
      const offsetLat = (rng() - 0.5) * 0.012;
      const offsetLng = (rng() - 0.5) * 0.012;
      lat = base.latitude + offsetLat;
      lng = base.longitude + offsetLng;
      geoDist = 300 + Math.floor(rng() * 500);
      geoValid = false;
      geoErrorCount++;
    } else {
      lat = base.latitude + (rng() - 0.5) * 0.002;
      lng = base.longitude + (rng() - 0.5) * 0.002;
      geoDist = Math.floor(rng() * 150) + 5;
      geoValid = true;
    }

    if (isLate) lateCount++;

    let totpStatus: "VALIDATED" | "EXPIRED" | "PENDING";
    let totpValidatedAt: Date | null;
    let validatedBy: string | null;

    if (hasTotpExpired) {
      totpStatus = "EXPIRED";
      totpValidatedAt = null;
      validatedBy = null;
      totpExpiredCount++;
    } else if (isToday && a.status === "CHECKED_IN") {
      totpStatus = "VALIDATED";
      totpValidatedAt = new Date(cTime.getTime() + 15000 + rng() * 60000);
      validatedBy = prec;
    } else {
      totpStatus = "VALIDATED";
      totpValidatedAt = new Date(cTime.getTime() + 30000 + rng() * 120000);
      validatedBy = prec;
    }

    const row: CRow = {
      assignmentId: a.id, internId: a.internId,
      checkinLat: lat, checkinLng: lng,
      geoDistanceMeters: geoDist, geoValid,
      checkinAt: cTime,
      totpSecret: "SEED",
      totpValidatedAt,
      validatedBy,
      method: rng() > 0.3 ? "TELEGRAM_CODE" : "APP_DIRECT",
      status: totpStatus,
      checkoutAt: null, checkoutConfirmedBy: null, checkoutNotes: null,
    };

    if (a.status === "CHECKED_OUT") {
      const oHour = a.period === "DAY" ? 18 + Math.floor(rng() * 2) : 6 + Math.floor(rng() * 2);
      const oTime = new Date(aDate);
      oTime.setHours(oHour, Math.floor(rng() * 45), 0);
      if (a.period === "NIGHT") oTime.setDate(oTime.getDate() + 1);
      row.checkoutAt = oTime;
      row.checkoutConfirmedBy = prec;
      const notes = [null, null, null, "Plantão tranquilo.", "Sem intercorrências.", "02 ocorrências atendidas.", null, "Supervisionado pelo preceptor."];
      row.checkoutNotes = notes[ci % notes.length];
    }

    cRows.push(row);
  }

  for (let i = 0; i < cRows.length; i += 200) {
    await db.insert(checkins).values(cRows.slice(i, i + 200)).onConflictDoNothing();
  }
  console.log(`   -> ${cRows.length} check-ins (${geoErrorCount} erros Geo, ${totpExpiredCount} TOTP expirados, ${lateCount} atrasados)`);

  // 9. Requests — more variety
  console.log("🔄 Criando solicitações...");
  let reqCount = 0;

  for (let f = 0; f < 5; f++) {
    const fFuture = futureA.filter(a => a.facultyId === facIds[f]);
    const fHistory = historyA.filter(a => a.facultyId === facIds[f]);
    if (fFuture.length < 4) continue;

    // 2 DROP_SHIFT pending
    for (let k = 0; k < 2 && k < fFuture.length; k++) {
      await db.insert(requests).values({
        type: "DROP_SHIFT", requesterId: fFuture[k].internId,
        assignmentId: fFuture[k].id, status: "PENDING",
      }).onConflictDoNothing();
      reqCount++;
    }

    // 1 SWAP pending
    if (fFuture.length > 3 && fFuture[2].internId !== fFuture[3].internId) {
      await db.insert(requests).values({
        type: "SWAP", requesterId: fFuture[2].internId,
        assignmentId: fFuture[2].id,
        targetInternId: fFuture[3].internId,
        targetAssignmentId: fFuture[3].id,
        status: "PENDING",
      }).onConflictDoNothing();
      reqCount++;
    }

    // 1 EXTRA_SHIFT pending
    if (fFuture.length > 4) {
      await db.insert(requests).values({
        type: "EXTRA_SHIFT", requesterId: fFuture[4].internId,
        assignmentId: fFuture[4].id,
        extraBaseId: baseByCode[BASE_RANK[(f + 3) % BASE_RANK.length]]?.id,
        extraDate: fFuture[4].date,
        extraPeriod: "NIGHT",
        status: "PENDING",
      }).onConflictDoNothing();
      reqCount++;
    }

    // Historical approved / rejected
    if (fHistory.length > 2) {
      await db.insert(requests).values({
        type: "DROP_SHIFT", requesterId: fHistory[0].internId,
        assignmentId: fHistory[0].id, status: "APPROVED",
        reviewedBy: coordId, reviewedAt: addDays(today, -4),
        reviewNotes: "Aprovado — atestado médico apresentado.",
      }).onConflictDoNothing();
      reqCount++;

      await db.insert(requests).values({
        type: "EXTRA_SHIFT", requesterId: fHistory[1].internId,
        assignmentId: fHistory[1].id,
        extraBaseId: baseByCode[BASE_RANK[(f + 1) % BASE_RANK.length]]?.id,
        extraDate: dateStr(addDays(today, -2)),
        extraPeriod: "NIGHT",
        status: "REJECTED",
        reviewedBy: coordId, reviewedAt: addDays(today, -2),
        reviewNotes: "Carga horária semanal já atingida.",
      }).onConflictDoNothing();
      reqCount++;

      if (fHistory.length > 4 && fHistory[3].internId !== fHistory[4].internId) {
        await db.insert(requests).values({
          type: "SWAP", requesterId: fHistory[3].internId,
          assignmentId: fHistory[3].id,
          targetInternId: fHistory[4].internId,
          targetAssignmentId: fHistory[4].id,
          status: "APPROVED",
          reviewedBy: coordId, reviewedAt: addDays(today, -5),
          reviewNotes: "Troca deferida entre internos da mesma faculdade.",
        }).onConflictDoNothing();
        reqCount++;
      }
    }
  }
  console.log(`   -> ${reqCount} solicitações`);

  // 10. Case records — more scenarios
  console.log("🏥 Criando ocorrências clínicas...");
  const recentOk = historyA.filter(a => a.status === "CHECKED_OUT").slice(-20);
  let caseCount = 0;
  for (let i = 0; i < Math.min(CASE_SCENARIOS.length, recentOk.length); i++) {
    const a = recentOk[i];
    const c = CASE_SCENARIOS[i];
    await db.insert(caseRecords).values({
      assignmentId: a.id, internId: a.internId,
      caseNumber: String(i + 1).padStart(4, "0"),
      nickname: c.nickname, description: c.description,
    }).onConflictDoNothing();
    caseCount++;
  }
  console.log(`   -> ${caseCount} ocorrências`);

  // 11. Audit log
  console.log("📝 Criando auditoria...");
  const auditEntries: Array<{ userId: string; action: string; entity: string; payload: Record<string, unknown> }> = [
    { userId: coordId, action: "SYSTEM_SEED", entity: "system", payload: { type: "prod-seed-v2", interns: 60, faculties: 5 } },
  ];
  for (let f = 0; f < 5; f++) {
    const lid = cpfToId.get(memberData[f * 12].cpf)!;
    auditEntries.push({ userId: lid, action: "ASSIGNMENT_CREATED", entity: "assignments", payload: { faculty: FAC_ABBR[f], type: "batch" } });
  }
  for (const e of auditEntries) {
    await db.insert(auditLog).values({ ...e, ipAddress: "127.0.0.1" }).onConflictDoNothing();
  }

  // 12. Summary
  const absentH = historyA.filter(a => a.status === "ABSENT").length;
  const checkedInToday = todayA.filter(a => a.status === "CHECKED_IN").length;

  console.log(`
${"=".repeat(70)}
  SEED DE PRODUÇÃO CONCLUÍDO (v2 — rico)
${"=".repeat(70)}

  Dados criados:
   - 5 Faculdades x 12 internos = 60 (5 com duplo LEADER+INTERN)
   - 20 Preceptores (~1.5 por base)
   - ${slotRows.length} regras de vagas
   - ${historyA.length} plantões passados (${absentH} ausentes)
   - ${todayA.length} plantões hoje (${checkedInToday} com check-in ativo)
   - ${futureA.length} plantões futuros
   - ${reqCount} solicitações (PENDING + APPROVED + REJECTED)
   - ${caseCount} ocorrências clínicas
   - Check-ins: ${geoErrorCount} erros Geo, ${totpExpiredCount} TOTP expirados, ${lateCount} atrasados

  Credenciais:
   Admin:          admin@taximetro.app / admin123
   Líder ZARNS:    ${memberData[0].email} / demo123  (${memberData[0].name})
   Líder UFBA:     ${memberData[12].email} / demo123  (${memberData[12].name})
   Interno AFYA:   ${memberData[26].email} / demo123  (${memberData[26].name})
   Prec SM01:      camila.prec1@demo.dev / demo123
   Prec CRU:       sonia.prec13@demo.dev / demo123
`);

  await client.end();
}

seedProd().catch((err) => {
  console.error("Seed falhou:", err);
  process.exit(1);
});
