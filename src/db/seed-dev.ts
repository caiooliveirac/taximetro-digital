/**
 * seed-dev.ts — Seed robusto de desenvolvimento.
 *
 * Cenário:
 *   - 1 Coordenador (do seed.ts)
 *   - 13 Preceptores (1 por base)
 *   - 5 Faculdades × 40 = 200 internos
 *     └─ 2 por faculdade com duplo papel LEADER + INTERN
 *     └─ 38 por faculdade como INTERN puro
 *   - 266 regras de vagas com distribuição justa via rotação
 *   - Ranking: SM01 → PP20 (mais → menos importante)
 *   - Cada base: 2 vagas DAY/dia; top 6 bases: +2 vagas NIGHT/dia
 *   - 30 dias de histórico + hoje + 14 dias futuros
 *   - Solicitações, ocorrências, auditoria, convites
 *
 * Uso:
 *   npm run db:reset    (limpa + seed base + seed-dev)
 *   npm run db:seed-dev (apenas seed-dev, exige seed base)
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hash } from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import {
  bases, faculties, users, userRoles, slotRules,
  assignments, checkins, requests, caseRecords, auditLog,
  inviteLinks,
} from "./schema";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/taximetro";

// ── Nomes brasileiros ────────────────────────────────────────────

const FIRST_F = [
  "Mariana", "Beatriz", "Ana", "Júlia", "Camila", "Fernanda", "Larissa", "Isabela",
  "Amanda", "Carolina", "Letícia", "Bruna", "Patrícia", "Raquel", "Natália", "Débora",
  "Renata", "Tatiana", "Vanessa", "Aline", "Clara", "Lívia", "Priscila", "Marina",
  "Gabriela", "Luísa", "Helena", "Bianca", "Tainá", "Laura",
];

const FIRST_M = [
  "Lucas", "Pedro", "Gabriel", "Rafael", "Matheus", "Gustavo", "Felipe", "Bruno",
  "Thiago", "André", "Vinícius", "Leonardo", "Diego", "Henrique", "Arthur", "Caio",
  "Daniel", "Rodrigo", "Samuel", "Igor", "Eduardo", "Bernardo", "João", "Marcos",
  "Luciano", "Nicolas", "Renan", "Wallace", "Elias", "William",
];

const SURNAMES = [
  "Silva", "Santos", "Oliveira", "Souza", "Lima", "Ferreira", "Almeida", "Costa",
  "Ribeiro", "Nascimento", "Carvalho", "Mendes", "Rocha", "Martins", "Freitas",
  "Barbosa", "Pereira", "Araújo", "Lopes", "Correia", "Duarte", "Nunes", "Vieira",
  "Campos", "Moreira", "Teixeira", "Monteiro", "Reis", "Melo", "Cardoso", "Barreto",
  "Cunha", "Nogueira", "Pinto", "Fonseca", "Sampaio", "Gomes", "Brito", "Castro", "Ramos",
];

// ── Constantes ────────────────────────────────────────────────────

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
  { nickname: "Acidente Ofídico", description: "Masculino 34a, jararaca em MID. Edema progressivo. Soro antibotrópico 4 ampolas." },
  { nickname: "Convulsão Febril", description: "Criança 2a, convulsão tônico-clônica 3 min. T 39.8C. Diazepam retal 5mg. Cessou crise." },
  { nickname: "IAM com Supra ST", description: "Masculino 62a, dor torácica 40 min. Supra V1-V4. AAS+Clopidogrel. Hemodinâmica ativada." },
  { nickname: "Afogamento Grau 3", description: "Masculino 17a, resgatado em praia. SpO2 89%. O2 15L/min. SNG descompressiva." },
];

const PREC_NAMES = [
  "Dra. Preceptora 17", "Dr. Preceptor 11", "Dra. Preceptora 14", "Dr. Preceptor 14",
  "Dra. Preceptora 13", "Dr. Preceptor 12", "Dra. Preceptora 15", "Dr. Preceptor 15",
  "Dra. Preceptora 11", "Dr. Preceptor 13", "Dra. Preceptora 12", "Dr. Preceptor 16",
  "Dra. Preceptora 16",
];

// ── Helpers ──────────────────────────────────────────────────────

function dateStr(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function stripAccents(s: string) { return s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }

function fakeCPF(n: number): string {
  const s = n.toString().padStart(11, "0");
  return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9, 11)}`;
}

/**
 * Fair rotation: returns the two faculty indices (0-4) that share
 * capacity=1 at a given base rank + day-of-week + period.
 * NIGHT uses +2 offset so DAY/NIGHT pairs never overlap at same base+day.
 */
function slotPair(baseRank: number, dayIdx: number, isNight: boolean): [number, number] {
  const s = (baseRank * 2 + dayIdx * 2 + (isNight ? 2 : 0)) % 5;
  return [s, (s + 1) % 5];
}

// Deterministic PRNG (LCG)
let _rng = 42;
function rng() { _rng = (_rng * 1103515245 + 12345) & 0x7fffffff; return _rng / 0x7fffffff; }

// ─────────────────────────────────────────────────────────────────

async function seedDev() {
  const client = postgres(DATABASE_URL);
  const db = drizzle(client);
  const pw = await hash("demo123", 12);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // ============================================================
  // 1. Verify base seed
  // ============================================================
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
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.cpf, "000.000.000-00"));
  const coordId = admin!.id;

  // ============================================================
  // 2. Faculty targets (segmented by base type: USA/CRU/CRL)
  // ============================================================
  console.log("🎯 Atualizando metas por tipo de base...");
  const targets: Record<string, { usas: number; crus: number; crls: number; hours: number; total: number }> = {
    ZARNS: { usas: 1, crus: 1, crls: 1, hours: 480, total: 3 },     // dev: higher targets
    UFBA: { usas: 1, crus: 1, crls: 0, hours: 480, total: 2 },
    AFYA: { usas: 1, crus: 1, crls: 1, hours: 480, total: 3 },
    UNIFACS: { usas: 0, crus: 1, crls: 1, hours: 480, total: 2 },
    EBMSP: { usas: 0, crus: 4, crls: 0, hours: 480, total: 4 },     // EBMSP: 4 CRU per week (6h shifts)
  };
  
  for (const abbr of FAC_ABBR) {
    const t = targets[abbr];
    await db.update(faculties).set({
      targetHours: t.hours, targetShifts: 50,
      targetShiftsPerWeek: t.total, // backward compat
      targetUSAsPerWeek: t.usas,
      targetCRUsPerWeek: t.crus,
      targetCRLsPerWeek: t.crls,
      totalInterns: 40,
    }).where(eq(faculties.id, facByAbbr[abbr].id));
  }

  // ============================================================
  // 3. Preceptors (13 — one per base)
  // ============================================================
  console.log("👤 Criando 13 preceptores...");
  const orderedBaseCodes = [...BASE_RANK, "CRU"];
  const precIds: string[] = [];
  const precByBase: Record<string, string> = {};

  for (let i = 0; i < 13; i++) {
    const cpf = fakeCPF(i + 1);
    const [created] = await db.insert(users).values({
      name: PREC_NAMES[i], cpf, email: `prec${i + 1}@demo.dev`, passwordHash: pw,
    }).onConflictDoNothing().returning({ id: users.id });
    const id = created?.id ?? (await db.select({ id: users.id }).from(users).where(eq(users.cpf, cpf)))[0].id;
    const base = baseByCode[orderedBaseCodes[i]] ?? cruBase;
    await db.insert(userRoles).values({ userId: id, role: "PRECEPTOR", baseId: base.id }).onConflictDoNothing();
    precIds.push(id);
    precByBase[base.id] = id;
  }

  // ============================================================
  // 4. Faculty members: 5 x 40 = 200
  // ============================================================
  console.log("👤 Criando 200 internos (10 com duplo LEADER+INTERN)...");

  const usedNames = new Set<string>();
  function genName(idx: number): string {
    const pool = idx % 2 === 0 ? FIRST_F : FIRST_M;
    const firstName = pool[Math.floor(idx / 2) % pool.length];
    let s1 = idx % SURNAMES.length;
    let s2 = (s1 + 1 + Math.floor(idx / SURNAMES.length)) % SURNAMES.length;
    if (s2 === s1) s2 = (s2 + 1) % SURNAMES.length;
    let name = `${firstName} ${SURNAMES[s1]} ${SURNAMES[s2]}`;
    while (usedNames.has(name)) {
      s2 = (s2 + 1) % SURNAMES.length;
      if (s2 === s1) s2 = (s2 + 1) % SURNAMES.length;
      name = `${firstName} ${SURNAMES[s1]} ${SURNAMES[s2]}`;
    }
    usedNames.add(name);
    return name;
  }

  type MemberInfo = { name: string; cpf: string; email: string; facIdx: number; pos: number };
  const memberData: MemberInfo[] = [];
  let cpfCounter = 100;
  for (let f = 0; f < 5; f++) {
    for (let u = 0; u < 40; u++) {
      const globalIdx = f * 40 + u;
      const name = genName(globalIdx);
      const emailPrefix = stripAccents(name.split(" ")[0].toLowerCase());
      memberData.push({
        name,
        cpf: fakeCPF(cpfCounter++),
        email: `${emailPrefix}.${FAC_ABBR[f].toLowerCase()}${u}@demo.dev`,
        facIdx: f,
        pos: u,
      });
    }
  }

  // Batch insert users
  await db.insert(users).values(
    memberData.map(m => ({ name: m.name, cpf: m.cpf, email: m.email, passwordHash: pw })),
  ).onConflictDoNothing();

  const allCreated = await db.select({ id: users.id, cpf: users.cpf })
    .from(users)
    .where(inArray(users.cpf, memberData.map(m => m.cpf)));
  const cpfToId = new Map(allCreated.map(r => [r.cpf, r.id]));

  // Build role rows
  const roleRows: { userId: string; role: "LEADER" | "INTERN"; facultyId: string }[] = [];
  const facInternIds: string[][] = [[], [], [], [], []];

  for (const m of memberData) {
    const userId = cpfToId.get(m.cpf)!;
    facInternIds[m.facIdx].push(userId);
    if (m.pos < 2) {
      roleRows.push({ userId, role: "LEADER", facultyId: facIds[m.facIdx] });
    }
    roleRows.push({ userId, role: "INTERN", facultyId: facIds[m.facIdx] });
  }

  for (let i = 0; i < roleRows.length; i += 200) {
    await db.insert(userRoles).values(roleRows.slice(i, i + 200)).onConflictDoNothing();
  }
  console.log(`   -> ${allCreated.length} usuarios, ${roleRows.length} roles`);

  // ============================================================
  // 5. Invite links (1 per faculty)
  // ============================================================
  console.log("🔗 Criando links de convite...");
  for (let f = 0; f < 5; f++) {
    const leaderId = cpfToId.get(memberData[f * 40].cpf)!;
    await db.insert(inviteLinks).values({
      token: `demo-${FAC_ABBR[f].toLowerCase()}-2026`,
      createdBy: leaderId, facultyId: facIds[f],
      expiresAt: addDays(today, 7), isActive: true,
    }).onConflictDoNothing();
  }

  // ============================================================
  // 6. Slot rules (fair rotation)
  // ============================================================
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

  // CRU: DAY only
  for (let d = 0; d < 7; d++) {
    const [ca, cb] = slotPair(12, d, false);
    slotRows.push({ baseId: cruBase.id, dayOfWeek: DOW[d], period: "DAY", facultyId: facIds[ca], capacity: 1 });
    slotRows.push({ baseId: cruBase.id, dayOfWeek: DOW[d], period: "DAY", facultyId: facIds[cb], capacity: 1 });
  }

  for (let i = 0; i < slotRows.length; i += 200) {
    await db.insert(slotRules).values(slotRows.slice(i, i + 200)).onConflictDoNothing();
  }
  console.log(`   -> ${slotRows.length} regras de vagas`);

  // ============================================================
  // 7. Pre-compute positions per faculty per day-of-week
  // ============================================================
  type Pos = { baseId: string; baseCode: string; period: "DAY" | "NIGHT" };
  const facPos: Pos[][][] = []; // facPos[f][dow] = Pos[]

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
      if (ca === f || cb === f) pos.push({ baseId: cruBase.id, baseCode: "CRU", period: "DAY" });
      pos.sort((a, b) => {
        if (a.period !== b.period) return a.period === "DAY" ? -1 : 1;
        const ai = BASE_RANK.indexOf(a.baseCode);
        const bi = BASE_RANK.indexOf(b.baseCode);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      });
      facPos[f][d] = pos;
    }
  }

  // ============================================================
  // 8. Generate assignments (-30 to +14)
  // ============================================================
  console.log("📅 Gerando atribuicoes (-30 a +14)...");

  type ARow = {
    internId: string; facultyId: string; baseId: string;
    date: string; period: "DAY" | "NIGHT"; status: string; createdBy: string;
  };
  const allRows: ARow[] = [];
  const booked = new Set<string>();

  for (let dayOff = -30; dayOff <= 14; dayOff++) {
    const d = addDays(today, dayOff);
    const dIdx = (d.getDay() + 6) % 7; // MON=0..SUN=6
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
              status = ((Math.abs(dayOff) * 7 + f * 3 + pi) % 10 === 0) ? "ABSENT" : "CHECKED_OUT";
            } else if (dayOff === 0) {
              const roll = (f * 5 + pi) % 7;
              status = roll === 0 ? "CHECKED_IN" : roll === 1 ? "ABSENT" : "SCHEDULED";
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

  // Batch insert
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

  // ============================================================
  // 9. Check-ins
  // ============================================================
  console.log("✅ Criando check-ins...");
  const needCheckin = insertedAll.filter(a => a.status === "CHECKED_OUT" || a.status === "CHECKED_IN");

  type CRow = {
    assignmentId: string; internId: string;
    checkinLat: number | null; checkinLng: number | null;
    geoDistanceMeters: number | null; geoValid: boolean | null;
    checkinAt: Date | null; totpSecret: string | null;
    totpValidatedAt: Date | null; validatedBy: string | null;
    method: "TELEGRAM_CODE" | "APP_DIRECT" | null;
    status: "VALIDATED";
    checkoutAt: Date | null; checkoutConfirmedBy: string | null;
    checkoutNotes: string | null;
  };
  const cRows: CRow[] = [];

  for (const a of needCheckin) {
    const base = allBases.find(b => b.id === a.baseId)!;
    const aDate = new Date(a.date + "T12:00:00");
    const cHour = a.period === "DAY" ? 6 + Math.floor(rng() * 2) : 18 + Math.floor(rng() * 2);
    const cTime = new Date(aDate); cTime.setHours(cHour, Math.floor(rng() * 45), 0);
    const prec = precByBase[a.baseId] ?? precIds[0];

    const row: CRow = {
      assignmentId: a.id, internId: a.internId,
      checkinLat: base.latitude + (rng() - 0.5) * 0.002,
      checkinLng: base.longitude + (rng() - 0.5) * 0.002,
      geoDistanceMeters: Math.floor(rng() * 150) + 10,
      geoValid: true, checkinAt: cTime,
      totpSecret: "JBSWY3DPEHPK3PXP",
      totpValidatedAt: new Date(cTime.getTime() + 30000 + rng() * 120000),
      validatedBy: prec,
      method: rng() > 0.3 ? "TELEGRAM_CODE" : "APP_DIRECT",
      status: "VALIDATED",
      checkoutAt: null, checkoutConfirmedBy: null, checkoutNotes: null,
    };

    if (a.status === "CHECKED_OUT") {
      const oHour = a.period === "DAY" ? 18 + Math.floor(rng() * 2) : 6 + Math.floor(rng() * 2);
      const oTime = new Date(aDate); oTime.setHours(oHour, Math.floor(rng() * 45), 0);
      if (a.period === "NIGHT") oTime.setDate(oTime.getDate() + 1);
      row.checkoutAt = oTime;
      row.checkoutConfirmedBy = prec;
      row.checkoutNotes = rng() > 0.75 ? "Plantao sem intercorrencias." : null;
    }
    cRows.push(row);
  }

  for (let i = 0; i < cRows.length; i += 200) {
    await db.insert(checkins).values(cRows.slice(i, i + 200)).onConflictDoNothing();
  }
  console.log(`   -> ${cRows.length} check-ins`);

  // ============================================================
  // 10. Requests (realistic scenarios with history)
  // ============================================================
  console.log("🔄 Criando solicitacoes...");
  let reqCount = 0;

  for (let f = 0; f < 5; f++) {
    const fFuture = futureA.filter(a => a.facultyId === facIds[f]);
    const fHistory = historyA.filter(a => a.facultyId === facIds[f] && a.status === "CHECKED_OUT");
    if (fFuture.length < 4) continue;

    // --- PENDING requests (to be reviewed) ---

    // DROP (pending) — only for future SCHEDULED assignments
    await db.insert(requests).values({
      type: "DROP_SHIFT", requesterId: fFuture[0].internId,
      assignmentId: fFuture[0].id, status: "PENDING",
    }).onConflictDoNothing();
    reqCount++;

    // SWAP (pending) — ensure distinct interns and distinct assignments
    const swapA = fFuture[1];
    const swapB = fFuture.find(a => a.internId !== swapA?.internId && a.id !== swapA?.id);
    if (swapA && swapB) {
      await db.insert(requests).values({
        type: "SWAP", requesterId: swapA.internId,
        assignmentId: swapA.id,
        targetInternId: swapB.internId,
        targetAssignmentId: swapB.id,
        status: "PENDING",
      }).onConflictDoNothing();
      reqCount++;
    }

    // EXTRA (pending)
    // Use an assignment not already involved in another request
    const extraCandidate = fFuture.find(a =>
      a.id !== fFuture[0]?.id && a.id !== swapA?.id && a.id !== swapB?.id
    );
    if (extraCandidate) {
      const extraBase = baseByCode[BASE_RANK[(f + 3) % BASE_RANK.length]];
      await db.insert(requests).values({
        type: "EXTRA_SHIFT", requesterId: extraCandidate.internId,
        assignmentId: extraCandidate.id,
        extraBaseId: extraBase?.id,
        extraDate: dateStr(addDays(today, 10)),
        extraPeriod: "NIGHT",
        status: "PENDING",
      }).onConflictDoNothing();
      reqCount++;
    }

    // --- Historical requests (already processed) ---

    if (fHistory.length > 4) {
      // Approved DROP
      await db.insert(requests).values({
        type: "DROP_SHIFT", requesterId: fHistory[0].internId,
        assignmentId: fHistory[0].id, status: "COMPLETED",
        reviewedBy: coordId, reviewedAt: addDays(today, -10),
        reviewNotes: "Aprovado — atestado médico apresentado.",
      }).onConflictDoNothing();
      reqCount++;

      // Rejected EXTRA
      await db.insert(requests).values({
        type: "EXTRA_SHIFT", requesterId: fHistory[1].internId,
        assignmentId: fHistory[1].id,
        extraBaseId: baseByCode[BASE_RANK[(f + 1) % BASE_RANK.length]]?.id,
        extraDate: dateStr(addDays(today, -5)),
        extraPeriod: "NIGHT",
        status: "REJECTED",
        reviewedBy: coordId, reviewedAt: addDays(today, -5),
        reviewNotes: "Carga horária semanal já atingida.",
      }).onConflictDoNothing();
      reqCount++;

      // Completed SWAP
      const hSwapA = fHistory[3];
      const hSwapB = fHistory.find(a => a.internId !== hSwapA.internId && a.id !== hSwapA.id);
      if (hSwapB) {
        await db.insert(requests).values({
          type: "SWAP", requesterId: hSwapA.internId,
          assignmentId: hSwapA.id,
          targetInternId: hSwapB.internId,
          targetAssignmentId: hSwapB.id,
          status: "COMPLETED",
          reviewedBy: coordId, reviewedAt: addDays(today, -7),
          reviewNotes: "Troca deferida entre internos da mesma faculdade.",
        }).onConflictDoNothing();
        reqCount++;
      }
    }
  }
  console.log(`   -> ${reqCount} solicitacoes`);

  // ============================================================
  // 11. Case records
  // ============================================================
  console.log("🏥 Criando ocorrencias clinicas...");
  const recentOk = historyA.filter(a => a.status === "CHECKED_OUT").slice(-16);
  let caseCount = 0;
  for (let i = 0; i < Math.min(CASE_SCENARIOS.length * 2, recentOk.length); i++) {
    const a = recentOk[i];
    const c = CASE_SCENARIOS[i % CASE_SCENARIOS.length];
    await db.insert(caseRecords).values({
      assignmentId: a.id, internId: a.internId,
      caseNumber: String(i + 1).padStart(4, "0"),
      nickname: c.nickname, description: c.description,
    }).onConflictDoNothing();
    caseCount++;
  }
  console.log(`   -> ${caseCount} ocorrencias`);

  // ============================================================
  // 12. Audit log
  // ============================================================
  console.log("📝 Criando auditoria...");
  const auditEntries: { userId: string; action: string; entity: string; payload: Record<string, unknown> }[] = [
    { userId: coordId, action: "SYSTEM_SEED", entity: "system", payload: { type: "dev-seed", interns: 200, faculties: 5 } },
  ];
  for (let f = 0; f < 5; f++) {
    const lid = cpfToId.get(memberData[f * 40].cpf)!;
    auditEntries.push({ userId: lid, action: "INVITE_LINK_CREATED", entity: "invite_links", payload: { faculty: FAC_ABBR[f] } });
    auditEntries.push({ userId: lid, action: "ASSIGNMENT_CREATED", entity: "assignments", payload: { faculty: FAC_ABBR[f], type: "batch" } });
  }
  for (let i = 0; i < 4; i++) {
    auditEntries.push({ userId: precIds[i], action: "CHECKIN_VALIDATED", entity: "checkins", payload: { method: "TELEGRAM_CODE", base: orderedBaseCodes[i] } });
  }
  for (const e of auditEntries) {
    await db.insert(auditLog).values({ ...e, ipAddress: "127.0.0.1" }).onConflictDoNothing();
  }
  console.log(`   -> ${auditEntries.length} registros`);

  // ============================================================
  // 13. Summary
  // ============================================================
  const absentH = historyA.filter(a => a.status === "ABSENT").length;
  const facWeek: string[] = [];
  for (let f = 0; f < 5; f++) {
    let day = 0; let night = 0;
    for (let d = 0; d < 7; d++) for (const p of facPos[f][d]) { if (p.period === "DAY") day++; else night++; }
    facWeek.push(`   ${String(FAC_ABBR[f]).padEnd(8)} ${day} DAY + ${night} NIGHT = ${day + night} slots/semana`);
  }

  console.log(`
${"=".repeat(70)}
  SEED DE DESENVOLVIMENTO CONCLUIDO
${"=".repeat(70)}

  Dados criados:
   - 5 Faculdades x 40 internos = 200 (10 com duplo LEADER+INTERN)
   - 13 Preceptores (1 por base)
   - ${slotRows.length} regras de vagas (rotacao justa)
   - ${historyA.length} plantoes passados (${absentH} ausentes ~ ${Math.round(absentH / Math.max(historyA.length, 1) * 100)}%)
   - ${todayA.length} plantoes hoje
   - ${futureA.length} plantoes futuros
   - ${reqCount} solicitacoes
   - ${caseCount} ocorrencias clinicas
   - ${auditEntries.length} registros de auditoria

  Distribuicao semanal:
${facWeek.join("\n")}

  Credenciais:
   Admin:          000.000.000-00 / admin123
   Lider+Int [0]:  ${memberData[0].cpf} / demo123  (${memberData[0].name})
   Lider+Int [1]:  ${memberData[1].cpf} / demo123  (${memberData[1].name})
   Lider UFBA[0]:  ${memberData[40].cpf} / demo123  (${memberData[40].name})
   Prec SM01:      ${fakeCPF(1)} / demo123
   Prec CRU:       ${fakeCPF(13)} / demo123
`);

  await client.end();
}

seedDev().catch((err) => {
  console.error("Seed falhou:", err);
  process.exit(1);
});
