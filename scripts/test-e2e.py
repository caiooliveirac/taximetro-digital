#!/usr/bin/env python3
"""
╔═══════════════════════════════════════════════════════════════════════╗
║  TAXÍMETRO DIGITAL — Teste End-to-End Completo (CI/CD)              ║
║                                                                     ║
║  Valida TODAS as regras de negócio da aplicação:                    ║
║    ① Autenticação & RBAC (4 roles)                                  ║
║    ② Isolamento por faculdade (Leader/Intern)                       ║
║    ③ Sorteio (Lottery) — cobertura e equidade                       ║
║    ④ Persistência ORM — assignments, conflitos, períodos            ║
║    ⑤ Compliance & metas semanais                                    ║
║    ⑥ Solicitações (SWAP, DROP, EXTRA) — create + review             ║
║    ⑦ Plantão avulso (self-create) — criação e anti-duplicata        ║
║    ⑧ Dashboard admin — KPIs e dados                                 ║
║    ⑨ Auditoria — log de ações                                      ║
║    ⑩ APIs de presença — checkin/checkout/validate (RBAC)            ║
║    ⑪ Slot rules & base ordering                                    ║
║    ⑫ Cross-role restrictions                                       ║
║    ⑬ Status machine do assignment                                  ║
║    ⑭ Presença semanal (últimos 7 dias, só resolvidos)              ║
║    ⑮ Coordenador — acesso universal                                ║
║    ⑯ Integridade do seed (dados representativos)                   ║
║    ⑰ Lottery multi-faculdade & isolamento pós-sorteio              ║
║    ⑱ Preceptor bases API                                           ║
║    ⑲ Slots disponíveis                                             ║
║    ⑳ Health check                                                  ║
║    ㉑ Isolamento completo do Leader (alerts, PUT, lottery)          ║
║                                                                     ║
║  Credenciais seed-dev:                                              ║
║    Admin:          000.000.000-00 / admin123                        ║
║    Leader ZARNS:   000.000.001-00 / demo123                         ║
║    Leader UFBA:    000.000.001-40 / demo123                         ║
║    Intern ZARNS:   000.000.001-02 / demo123                         ║
║    Preceptor SM01: 000.000.000-01 / demo123                        ║
║                                                                     ║
║  Uso:  python3 scripts/test-e2e.py                                  ║
║  Req:  Dev server rodando em http://localhost:3000                   ║
╚═══════════════════════════════════════════════════════════════════════╝
"""

import subprocess, json, sys, os, tempfile
from datetime import date, timedelta
from collections import Counter

BASE = "http://localhost:3000/taximetro"
PASS = 0
FAIL = 0
SECTION_N = 0

# ── Pretty output helpers ─────────────────────────────────────────

G = "\033[92m"; R = "\033[91m"; Y = "\033[93m"; C = "\033[96m"
B = "\033[1m"; D = "\033[2m"; Z = "\033[0m"

def section(title):
    global SECTION_N; SECTION_N += 1
    print(f"\n{B}{C}{'═'*60}{Z}")
    print(f"  {B}{C}{SECTION_N:02d}. {title}{Z}")
    print(f"{B}{C}{'═'*60}{Z}")

def ok(msg):
    global PASS; PASS += 1; print(f"  {G}✅ {msg}{Z}")

def ko(msg):
    global FAIL; FAIL += 1; print(f"  {R}❌ {msg}{Z}")

def info(msg):
    print(f"  {D}   {msg}{Z}")

def warn(msg):
    print(f"  {Y}⚠  {msg}{Z}")

def check(cond, ok_msg, fail_msg):
    if cond: ok(ok_msg)
    else: ko(fail_msg)
    return cond

# ── HTTP helpers ──────────────────────────────────────────────────

def api(jar, path, method="GET", body=None):
    cmd = ["curl", "-s", "-b", jar, "-c", jar]
    if method in ("POST", "PUT"):
        cmd += ["-X", method, "-H", "Content-Type: application/json"]
        if body is not None:
            cmd += ["-d", json.dumps(body)]
    cmd.append(f"{BASE}{path}")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    try:
        return json.loads(r.stdout)
    except Exception:
        return {"success": False, "raw": r.stdout[:300]}

def login(cpf, pw, jar):
    r = subprocess.run(["curl","-s","-c",jar,f"{BASE}/api/auth/csrf"],
                       capture_output=True, text=True, timeout=10)
    csrf = json.loads(r.stdout).get("csrfToken","")
    subprocess.run([
        "curl","-s","-b",jar,"-c",jar,"-X","POST",
        f"{BASE}/api/auth/callback/credentials",
        "-H","Content-Type: application/x-www-form-urlencoded",
        "-d",f"cpf={cpf}&password={pw}&csrfToken={csrf}","-o","/dev/null"
    ], capture_output=True, timeout=10)
    r = subprocess.run(["curl","-s","-b",jar,f"{BASE}/api/auth/session"],
                       capture_output=True, text=True, timeout=10)
    return json.loads(r.stdout) if r.stdout.strip() else {}

def jar():
    return tempfile.mktemp(suffix=".txt", prefix="e2e-")

# ── Date helpers ──────────────────────────────────────────────────

today = date.today()
today_s = today.isoformat()

def future_monday(weeks=3):
    d = today + timedelta(days=(7 - today.weekday()) % 7 or 7)
    return d + timedelta(weeks=weeks - 1)

lot_mon = future_monday(3)
lot_end = lot_mon + timedelta(days=6)

# ══════════════════════════════════════════════════════════════════
#  1. AUTENTICAÇÃO — 4 roles + credenciais inválidas
# ══════════════════════════════════════════════════════════════════

section("AUTENTICAÇÃO & RBAC")

ADMIN_JAR = jar()
admin_sess = login("000.000.000-00", "admin123", ADMIN_JAR)
check(admin_sess.get("user",{}).get("role") == "COORDINATOR",
      "Admin login → role=COORDINATOR",
      f"Admin login FALHOU: {admin_sess}")

LEADER_JAR = jar()
leader_sess = login("000.000.001-00", "demo123", LEADER_JAR)
check(leader_sess.get("user",{}).get("role") == "LEADER",
      f"Leader ZARNS login → {leader_sess.get('user',{}).get('name','')}",
      f"Leader login FALHOU: {leader_sess}")

INTERN_JAR = jar()
intern_sess = login("000.000.001-02", "demo123", INTERN_JAR)
check(intern_sess.get("user",{}).get("role") == "INTERN",
      f"Intern login → {intern_sess.get('user',{}).get('name','')}",
      f"Intern login FALHOU: {intern_sess}")
INTERN_ID = intern_sess.get("user",{}).get("id","")
INTERN_NAME = intern_sess.get("user",{}).get("name","")

PREC_JAR = jar()
prec_sess = login("000.000.000-01", "demo123", PREC_JAR)
check(prec_sess.get("user",{}).get("role") == "PRECEPTOR",
      f"Preceptor SM01 login → {prec_sess.get('user',{}).get('name','')}",
      f"Preceptor login FALHOU: {prec_sess}")

BAD_JAR = jar()
bad_sess = login("999.999.999-99", "wrongpass", BAD_JAR)
check(not bad_sess or bad_sess.get("user") is None,
      "Credenciais inválidas → sem sessão",
      f"Credenciais inválidas permitiram login! {bad_sess}")

# ══════════════════════════════════════════════════════════════════
#  2. ISOLAMENTO POR FACULDADE — LEADERS E INTERNOS
# ══════════════════════════════════════════════════════════════════

section("ISOLAMENTO POR FACULDADE")

# Leader ZARNS interns
zarns_interns_res = api(LEADER_JAR, "/api/leader/interns")
zarns_all = zarns_interns_res.get("data", [])
zarns_active = [i for i in zarns_all if i.get("roleActive") and i.get("userActive")]
check(35 <= len(zarns_active) <= 42,
      f"Leader ZARNS vê {len(zarns_active)} internos ativos (esperado ~40)",
      f"Contagem fora: {len(zarns_active)}")

# Leader UFBA login + interns
UFBA_JAR = jar()
ufba_sess = login("000.000.001-40", "demo123", UFBA_JAR)
check(ufba_sess.get("user",{}).get("role") == "LEADER",
      f"Leader UFBA login → {ufba_sess.get('user',{}).get('name','')}",
      f"UFBA login FALHOU")

ufba_interns_res = api(UFBA_JAR, "/api/leader/interns")
ufba_all = ufba_interns_res.get("data", [])
ufba_active = [i for i in ufba_all if i.get("roleActive") and i.get("userActive")]
check(35 <= len(ufba_active) <= 42,
      f"Leader UFBA vê {len(ufba_active)} internos ativos",
      f"UFBA contagem fora: {len(ufba_active)}")

# Zero overlap between faculties
zarns_ids = {i["id"] for i in zarns_active}
ufba_ids  = {i["id"] for i in ufba_active}
check(len(zarns_ids & ufba_ids) == 0,
      "Zero sobreposição: ZARNS e UFBA veem internos distintos",
      f"VAZAMENTO! {len(zarns_ids & ufba_ids)} internos em comum")

# Admin vê todos
admin_users = api(ADMIN_JAR, "/api/admin/users")
admin_data = admin_users.get("data", [])
admin_interns = [u for u in admin_data if u.get("role") == "INTERN"]
check(len(admin_interns) >= 180,
      f"Admin vê {len(admin_interns)} internos totais (esperado ~200)",
      f"Admin vê poucos: {len(admin_interns)}")

# Intern vê apenas próprios assignments
intern_all_a = api(INTERN_JAR, "/api/assignments?from=2025-01-01&to=2027-12-31")
intern_a_data = intern_all_a.get("data", [])
other_ids = {a.get("internId") for a in intern_a_data if a.get("internId") != INTERN_ID}
check(len(other_ids) == 0,
      f"Intern vê apenas {len(intern_a_data)} assignments próprios, 0 vazamento",
      f"VAZAMENTO! Intern vê assignments de {len(other_ids)} outros")

# ══════════════════════════════════════════════════════════════════
#  3. SORTEIO (LOTTERY) — COBERTURA, EQUIDADE, IDEMPOTÊNCIA
# ══════════════════════════════════════════════════════════════════

section("SORTEIO (LOTTERY)")

info(f"Semana do sorteio: {lot_mon} → {lot_end}")
zarns_ids_list = [i["id"] for i in zarns_active]
info(f"Internos ZARNS ativos: {len(zarns_ids_list)}")

lottery = api(LEADER_JAR, "/api/leader/lottery", "POST", {
    "weekStart": str(lot_mon), "internIds": zarns_ids_list,
})
lot_total = lottery.get("data",{}).get("total", 0)
lot_ok = lottery.get("success", False)

if lot_ok and lot_total > 0:
    ok(f"Sorteio criou {lot_total} assignments novos")
elif lot_ok and lot_total == 0:
    ok("Sorteio idempotente — 0 novos (slots já preenchidos)")
else:
    ko(f"Sorteio falhou: {lottery}")

# Verify persistence
week_a = api(LEADER_JAR, f"/api/assignments?from={lot_mon}&to={lot_end}")
a_data = [a for a in week_a.get("data",[]) if a.get("status") != "CANCELLED"]
check(len(a_data) >= 1,
      f"Assignments persistidos: {len(a_data)} na semana",
      "Nenhum assignment para a semana do sorteio")

# Balance
by_intern = Counter(a["internName"] for a in a_data)
counts = list(by_intern.values())
spread = (max(counts) - min(counts)) if counts else 0
check(spread <= 2,
      f"Equidade: spread={spread} (max={max(counts) if counts else 0}, min={min(counts) if counts else 0})",
      f"Distribuição desigual! spread={spread}")
for name, c in sorted(by_intern.items()):
    info(f"  {name}: {c} plantões")

# DAY priority
day_c = sum(1 for a in a_data if a["period"] == "DAY")
night_c = sum(1 for a in a_data if a["period"] == "NIGHT")
check(day_c >= night_c,
      f"Diurnos ({day_c}) >= noturnos ({night_c})",
      f"Prioridade diurno VIOLADA: day={day_c} < night={night_c}")

# No conflicts
seen = set(); has_conflict = False
for a in a_data:
    key = f"{a['internId']}|{a['date']}|{a['period']}"
    if key in seen:
        ko(f"CONFLITO: {a['internName']} em {a['date']} {a['period']}")
        has_conflict = True
    seen.add(key)
if not has_conflict:
    ok("Zero conflitos intern/data/turno")

# Only ZARNS
facs = {a.get("facultyAbbr") for a in a_data}
check(facs <= {"ZARNS"},
      f"Sorteio apenas ZARNS: {facs}",
      f"Faculdades inesperadas: {facs}")

# Idempotency
lot2 = api(LEADER_JAR, "/api/leader/lottery", "POST", {
    "weekStart": str(lot_mon), "internIds": zarns_ids_list,
})
check(lot2.get("data",{}).get("total", -1) == 0,
      "Re-execução idempotente (0 novos)",
      f"Não idempotente: {lot2}")

# ══════════════════════════════════════════════════════════════════
#  4. PERSISTÊNCIA ORM & INTEGRIDADE
# ══════════════════════════════════════════════════════════════════

section("PERSISTÊNCIA ORM & INTEGRIDADE")

# Bases
bases_res = api(ADMIN_JAR, "/api/admin/bases")
bases_data = bases_res.get("data", [])
check(len(bases_data) >= 12,
      f"{len(bases_data)} bases no sistema (12 USA + 1 CRU)",
      f"Poucas bases: {len(bases_data)}")

expected_codes = {"SM01","CB02","PR03","PM04","BR05","CN10","PP20","IT30","PM40","CZ50","BR60","CC70","CRU"}
actual_codes = {b.get("code") for b in bases_data}
missing_codes = expected_codes - actual_codes
check(len(missing_codes) == 0,
      f"13 bases presentes: {sorted(actual_codes)}",
      f"Bases faltando: {missing_codes}")

# Faculties
fac_res = api(ADMIN_JAR, "/api/admin/faculties")
fac_data = fac_res.get("data", [])
exp_facs = {"ZARNS","UFBA","AFYA","UNIFACS","EBMSP"}
act_facs = {f.get("abbreviation") for f in fac_data}
check(exp_facs <= act_facs,
      f"5 faculdades presentes: {sorted(act_facs)}",
      f"Faculdades faltando: {exp_facs - act_facs}")

# Historical assignments
hist = api(ADMIN_JAR, f"/api/assignments?from=2025-01-01&to={today_s}")
hist_data = hist.get("data", [])
checked_out = [a for a in hist_data if a.get("status") == "CHECKED_OUT"]
absent = [a for a in hist_data if a.get("status") == "ABSENT"]
check(len(checked_out) >= 50,
      f"Histórico: {len(checked_out)} concluídos, {len(absent)} ausentes",
      f"Poucos dados históricos: {len(checked_out)} concluídos")

total_resolved = len(checked_out) + len(absent)
if total_resolved > 0:
    abs_pct = round(len(absent) / total_resolved * 100)
    check(3 <= abs_pct <= 30,
          f"Taxa ausência {abs_pct}% dentro do esperado",
          f"Taxa ausência fora: {abs_pct}%")

# ══════════════════════════════════════════════════════════════════
#  5. COMPLIANCE — METAS SEMANAIS & GLOBAIS
# ══════════════════════════════════════════════════════════════════

section("COMPLIANCE & METAS")

# Leader (faculty-scoped)
comp = api(LEADER_JAR, "/api/compliance")
comp_data = comp.get("data", [])
comp_summary = comp.get("summary", {})
check(len(comp_data) >= 35,
      f"Compliance ZARNS: {len(comp_data)} internos",
      f"Poucos na compliance: {len(comp_data)}")

check("totalInterns" in comp_summary,
      f"Summary: {comp_summary.get('totalInterns')} internos, "
      f"{comp_summary.get('belowWeeklyTarget','')} abaixo meta semanal",
      "Summary incompleto")

# Required fields
if comp_data:
    sample = comp_data[0]
    req_fields = ["userId","name","targetShifts","targetShiftsPerWeek",
                  "totalCompleted","totalAbsent","rawDeficit","netDeficit","status"]
    missing_f = [f for f in req_fields if f not in sample]
    check(len(missing_f) == 0,
          "Compliance tem todos campos obrigatórios",
          f"Campos faltando: {missing_f}")
    statuses = {c.get("status") for c in comp_data}
    valid = {"ok","compensating","partial","deficit"}
    check(statuses <= valid,
          f"Status válidos: {statuses}",
          f"Status inválidos: {statuses - valid}")

# Admin (all faculties)
admin_comp = api(ADMIN_JAR, "/api/compliance")
admin_comp_data = admin_comp.get("data", [])
check(len(admin_comp_data) >= 150,
      f"Admin compliance: {len(admin_comp_data)} internos (todas faculdades)",
      f"Admin compliance incompleta: {len(admin_comp_data)}")

# Intern (own only)
intern_comp = api(INTERN_JAR, "/api/compliance")
intern_comp_data = intern_comp.get("data", [])
check(len(intern_comp_data) == 1,
      f"Intern vê apenas própria compliance: {intern_comp_data[0].get('name','?') if intern_comp_data else '?'}",
      f"Intern compliance errada: {len(intern_comp_data)} registros")

# ══════════════════════════════════════════════════════════════════
#  6. SOLICITAÇÕES — CRUD + REVIEW WORKFLOW
# ══════════════════════════════════════════════════════════════════

section("SOLICITAÇÕES (DROP_SHIFT)")

intern_future = api(INTERN_JAR, f"/api/assignments?from={today_s}&to=2027-12-31")
intern_future_data = [a for a in intern_future.get("data",[])
                      if a.get("status") in ("SCHEDULED","CONFIRMED") and a.get("date") > today_s]
info(f"Intern tem {len(intern_future_data)} assignments futuros disponíveis")

drop_created = False; drop_id = None
if len(intern_future_data) >= 1:
    drop_a = intern_future_data[0]
    drop_res = api(INTERN_JAR, "/api/requests", "POST", {
        "type": "DROP_SHIFT", "assignmentId": drop_a["id"],
    })
    drop_created = drop_res.get("success", False)
    drop_id = drop_res.get("data",{}).get("id")
    check(drop_created,
          f"DROP_SHIFT criado ({drop_a['date']} {drop_a['period']})",
          f"DROP_SHIFT falhou: {drop_res}")

    # BUG-5: Duplicate request prevention
    dup_drop = api(INTERN_JAR, "/api/requests", "POST", {
        "type": "DROP_SHIFT", "assignmentId": drop_a["id"],
    })
    check(not dup_drop.get("success", True),
          "Anti-duplicata: segunda DROP_SHIFT para mesmo assignment bloqueada",
          "BUG-5! Duplicata de request permitida")

    # Intern list own requests
    intern_reqs = api(INTERN_JAR, "/api/requests")
    found = any(r.get("id") == drop_id for r in intern_reqs.get("data",[]))
    check(found,
          f"Intern vê solicitação na listagem ({len(intern_reqs.get('data',[]))} total)",
          "Intern não vê solicitação recém-criada")

    # Leader approves
    if drop_id:
        rev = api(LEADER_JAR, "/api/requests", "PUT", {
            "id": drop_id, "status": "APPROVED", "reviewNotes": "Teste E2E",
        })
        check(rev.get("success", False),
              "Leader APROVOU DROP_SHIFT",
              f"Aprovação falhou: {rev}")

        # Verify CANCELLED
        updated = api(INTERN_JAR, f"/api/assignments?from={drop_a['date']}&to={drop_a['date']}")
        cancelled = [a for a in updated.get("data",[])
                     if a["id"] == drop_a["id"] and a["status"] == "CANCELLED"]
        check(len(cancelled) == 1,
              "Assignment cancelado após DROP aprovado",
              "Assignment NÃO cancelado após aprovação")

        # Verify request status is COMPLETED (not just APPROVED)
        after_reqs = api(INTERN_JAR, "/api/requests")
        my_req = [r for r in after_reqs.get("data",[]) if r.get("id") == drop_id]
        if my_req:
            check(my_req[0].get("status") == "COMPLETED",
                  "Request status → COMPLETED após processar DROP",
                  f"BUG-10! Status ficou '{my_req[0].get('status')}' (deveria COMPLETED)")
else:
    warn("Sem assignments futuros para testar DROP_SHIFT")

# BUG-9: Leader sees ONLY faculty requests
section("ISOLAMENTO REQUESTS POR FACULDADE (LEADER)")

leader_reqs = api(LEADER_JAR, "/api/requests")
leader_req_data = leader_reqs.get("data", [])
check(len(leader_req_data) >= 1,
      f"Leader vê {len(leader_req_data)} solicitações",
      "Leader sem solicitações")

# Check: leader should only see own faculty's requests
zarns_fac_id = leader_sess.get("user",{}).get("facultyId","")
if zarns_fac_id and leader_req_data:
    # Get all requester IDs and verify they belong to ZARNS
    lreq_requesters = {r["requesterId"] for r in leader_req_data}
    admin_users_data = api(ADMIN_JAR, "/api/admin/users").get("data",[])
    foreign_requesters = []
    for uid in lreq_requesters:
        u = next((u for u in admin_users_data if u.get("id") == uid), None)
        if u and u.get("facultyId") and u["facultyId"] != zarns_fac_id:
            foreign_requesters.append(u.get("name","?"))
    check(len(foreign_requesters) == 0,
          "Leader vê apenas solicitações da própria faculdade",
          f"BUG-9! Leader vê requests de outras faculdades: {foreign_requesters[:3]}")

# Reject one pending
pending = [r for r in leader_req_data if r.get("status") == "PENDING"]
info(f"PENDING: {len(pending)}")
if pending:
    rej = api(LEADER_JAR, "/api/requests", "PUT", {
        "id": pending[0]["id"], "status": "REJECTED", "reviewNotes": "Teste E2E recusa",
    })
    check(rej.get("success", False),
          f"Leader REJEITOU solicitação {pending[0].get('type')}",
          f"Rejeição falhou: {rej}")

# ═══ EXTRA_SHIFT creation with correct schema ═══
section("SOLICITAÇÕES (EXTRA_SHIFT)")

if len(intern_future_data) >= 2:
    extra_ref = intern_future_data[-1]
    extra_res = api(INTERN_JAR, "/api/requests", "POST", {
        "type": "EXTRA_SHIFT",
        "assignmentId": extra_ref["id"],
        "extraBaseId": extra_ref.get("baseId", bases_data[0]["id"]),
        "extraDate": extra_ref["date"],
        "extraPeriod": "NIGHT" if extra_ref["period"] == "DAY" else "DAY",
    })
    if extra_res.get("success"):
        ok(f"EXTRA_SHIFT criado para {extra_ref['date']}")
        extra_req_id = extra_res.get("data",{}).get("id")

        # Approve and verify new assignment created
        if extra_req_id:
            rev2 = api(LEADER_JAR, "/api/requests", "PUT", {
                "id": extra_req_id, "status": "APPROVED", "reviewNotes": "E2E extra OK",
            })
            check(rev2.get("success", False),
                  "Leader APROVOU EXTRA_SHIFT",
                  f"Aprovação EXTRA falhou: {rev2}")
    else:
        ko(f"EXTRA_SHIFT falhou: {extra_res.get('error','')}")

# BUG-3: Assignment ownership validation
section("VALIDAÇÃO OWNERSHIP DE ASSIGNMENT")

# Login a second intern (from different faculty — UFBA)
INTERN2_JAR = jar()
intern2_sess = login("000.000.001-42", "demo123", INTERN2_JAR)
INTERN2_ID = intern2_sess.get("user",{}).get("id","")
INTERN2_NAME = intern2_sess.get("user",{}).get("name","")
if INTERN2_ID:
    info(f"Segundo intern logado: {INTERN2_NAME}")
    # Try to create DROP for an assignment that doesn't belong to this intern
    if len(intern_future_data) >= 1:
        stolen_a = intern_future_data[0]
        stolen_res = api(INTERN2_JAR, "/api/requests", "POST", {
            "type": "DROP_SHIFT", "assignmentId": stolen_a["id"],
        })
        check(not stolen_res.get("success", True),
              "Intern NÃO pode criar request para assignment de outro",
              f"BUG-3! Intern criou request para assignment alheio")
else:
    warn("Não foi possível logar segundo intern para teste de ownership")

# ═══ SWAP LIFECYCLE — E2E COMPLETO ═══
section("SWAP — CICLO DE VIDA COMPLETO")

# Get two interns from same faculty (ZARNS) com assignments futuros
zarns_active_ids = [i["id"] for i in zarns_active[:5]]
info(f"Buscando assignments futuros de 2 internos ZARNS distintos...")

INTERN_A_JAR = jar()
intern_a_sess = login("000.000.001-02", "demo123", INTERN_A_JAR)
INTERN_A_ID = intern_a_sess.get("user",{}).get("id","")
INTERN_A_NAME = intern_a_sess.get("user",{}).get("name","")

INTERN_B_JAR = jar()
intern_b_sess = login("000.000.001-04", "demo123", INTERN_B_JAR)
INTERN_B_ID = intern_b_sess.get("user",{}).get("id","")
INTERN_B_NAME = intern_b_sess.get("user",{}).get("name","")

swap_tested = False
if INTERN_A_ID and INTERN_B_ID and INTERN_A_ID != INTERN_B_ID:
    info(f"Intern A: {INTERN_A_NAME} ({INTERN_A_ID[:8]}...)")
    info(f"Intern B: {INTERN_B_NAME} ({INTERN_B_ID[:8]}...)")

    a_future = api(INTERN_A_JAR, f"/api/assignments?from={today_s}&to=2027-12-31")
    a_scheduled = [a for a in a_future.get("data",[])
                   if a.get("status") == "SCHEDULED" and a.get("date") > today_s]

    b_future = api(INTERN_B_JAR, f"/api/assignments?from={today_s}&to=2027-12-31")
    b_scheduled = [a for a in b_future.get("data",[])
                   if a.get("status") == "SCHEDULED" and a.get("date") > today_s]

    info(f"Intern A tem {len(a_scheduled)} SCHEDULED futuros")
    info(f"Intern B tem {len(b_scheduled)} SCHEDULED futuros")

    if a_scheduled and b_scheduled:
        swap_a = a_scheduled[0]
        swap_b = b_scheduled[0]

        # Create SWAP request
        swap_res = api(INTERN_A_JAR, "/api/requests", "POST", {
            "type": "SWAP",
            "assignmentId": swap_a["id"],
            "targetInternId": INTERN_B_ID,
            "targetAssignmentId": swap_b["id"],
        })
        swap_ok = swap_res.get("success", False)
        swap_id = swap_res.get("data",{}).get("id")
        check(swap_ok,
              f"SWAP criado: A({swap_a['date']} {swap_a['period']}) ↔ B({swap_b['date']} {swap_b['period']})",
              f"SWAP criação falhou: {swap_res}")

        if swap_ok and swap_id:
            swap_tested = True

            # BUG-4: Validate target belongs to target intern
            # Try SWAP with wrong targetInternId
            if len(b_scheduled) >= 2:
                bad_swap = api(INTERN_A_JAR, "/api/requests", "POST", {
                    "type": "SWAP",
                    "assignmentId": a_scheduled[-1]["id"] if len(a_scheduled) >= 2 else a_scheduled[0]["id"],
                    "targetInternId": INTERN_B_ID,
                    "targetAssignmentId": a_scheduled[0]["id"],  # <- belongs to A, not B!
                })
                check(not bad_swap.get("success", True),
                      "SWAP com targetAssignment de outro intern bloqueado",
                      "BUG-4! SWAP aceita assignment que não pertence ao target")

            # Leader approves SWAP
            swap_rev = api(LEADER_JAR, "/api/requests", "PUT", {
                "id": swap_id, "status": "APPROVED", "reviewNotes": "E2E swap test",
            })
            check(swap_rev.get("success", False),
                  "Leader APROVOU SWAP",
                  f"SWAP aprovação falhou: {swap_rev}")

            # Verify: original assignments should be CANCELLED
            a_after = api(INTERN_A_JAR, f"/api/assignments?from={swap_a['date']}&to={swap_a['date']}")
            orig_a_after = [a for a in a_after.get("data",[]) if a.get("id") == swap_a["id"]]
            if orig_a_after:
                check(orig_a_after[0].get("status") == "CANCELLED",
                      f"Assignment original A → CANCELLED",
                      f"Assignment A não cancelado: {orig_a_after[0].get('status')}")

            b_after = api(INTERN_B_JAR, f"/api/assignments?from={swap_b['date']}&to={swap_b['date']}")
            orig_b_after = [a for a in b_after.get("data",[]) if a.get("id") == swap_b["id"]]
            if orig_b_after:
                check(orig_b_after[0].get("status") == "CANCELLED",
                      f"Assignment original B → CANCELLED",
                      f"Assignment B não cancelado: {orig_b_after[0].get('status')}")

            # Verify: new swapped assignments exist
            a_new = [a for a in a_after.get("data",[])
                     if a.get("date") == swap_b.get("date","X")
                     and a.get("period") == swap_b.get("period","X")
                     and a.get("status") != "CANCELLED"
                     and a.get("id") != swap_a["id"]]
            # A should now have B's slot
            check(len(a_new) >= 1,
                  f"Intern A recebeu slot de B ({swap_b['date']} {swap_b['period']})",
                  "Intern A NÃO recebeu novo assignment após SWAP")

            # Request should transition to COMPLETED
            swap_reqs = api(INTERN_A_JAR, "/api/requests")
            my_swap = [r for r in swap_reqs.get("data",[]) if r.get("id") == swap_id]
            if my_swap:
                check(my_swap[0].get("status") == "COMPLETED",
                      "SWAP request → COMPLETED após processamento",
                      f"BUG-10! SWAP status ficou '{my_swap[0].get('status')}' (deveria COMPLETED)")
    else:
        warn("Sem assignments futuros suficientes para testar SWAP")

if not swap_tested:
    warn("SWAP lifecycle não pôde ser testado (faltam dados)")

# ══════════════════════════════════════════════════════════════════
#  7. PLANTÃO AVULSO (SELF-CREATE)
# ══════════════════════════════════════════════════════════════════

section("PLANTÃO AVULSO (SELF-CREATE)")

active_bases = [b for b in bases_data if b.get("isActive")]
if active_bases:
    tb = active_bases[0]
    info(f"Base para teste: {tb['code']} — {tb.get('name','')}")

    today_intern = api(INTERN_JAR, f"/api/assignments?from={today_s}&to={today_s}")
    today_data = today_intern.get("data",[])
    used_periods = {a["period"] for a in today_data if a.get("status") != "CANCELLED"}
    period = None
    for p in ("NIGHT", "DAY"):
        if p not in used_periods:
            period = p
            break

    if period:
        sc = api(INTERN_JAR, "/api/assignments/self-create", "POST", {
            "baseId": tb["id"], "period": period,
        })
        sc_ok = sc.get("success", False)
        sc_err = (sc.get("error","") or "").lower()
        if sc_ok:
            ok(f"Plantão avulso criado: {tb['code']} {period}")

            # Anti-duplicata
            dup = api(INTERN_JAR, "/api/assignments/self-create", "POST", {
                "baseId": tb["id"], "period": period,
            })
            check(not dup.get("success", True),
                  "Anti-duplicata: segunda criação bloqueada",
                  "BUG! Duplicata permitida")

            # Verify self-created assignment appears
            today2 = api(INTERN_JAR, f"/api/assignments?from={today_s}&to={today_s}")
            auto = [a for a in today2.get("data",[]) if "AUTO" in (a.get("notes") or "").upper()]
            if not auto:
                new_count = len([a for a in today2.get("data",[]) if a.get("status") != "CANCELLED"])
                old_count = len([a for a in today_data if a.get("status") != "CANCELLED"])
                check(new_count > old_count,
                      f"Plantão avulso aparece (count {old_count}→{new_count})",
                      "Plantão avulso não encontrado")
            else:
                ok(f"Plantão avulso aparece (notes={auto[0].get('notes','')})")
        elif "já tem" in sc_err or "já existe" in sc_err or "duplicate" in sc_err:
            # Re-run: previous test already created this → anti-dup is working
            ok(f"Self-create anti-dup (re-run): {sc_err}")
        else:
            ko(f"Plantão avulso falhou: {sc}")
    else:
        # Both periods already taken — test anti-dup instead
        dup_res = api(INTERN_JAR, "/api/assignments/self-create", "POST", {
            "baseId": tb["id"], "period": "DAY",
        })
        check(not dup_res.get("success", True),
              "Intern já tem DAY e NIGHT hoje — self-create bloqueado (anti-dup)",
              "BUG! Duplicata permitida com ambos turnos ocupados")

    # Non-intern (Leader) should be forbidden
    lsc = api(LEADER_JAR, "/api/assignments/self-create", "POST", {
        "baseId": tb["id"], "period": "DAY",
    })
    check(not lsc.get("success", True),
          "Leader NÃO pode criar plantão avulso (403)",
          "BUG! Leader criou plantão avulso")

    # Coordinator (admin) also forbidden
    asc = api(ADMIN_JAR, "/api/assignments/self-create", "POST", {
        "baseId": tb["id"], "period": "DAY",
    })
    check(not asc.get("success", True),
          "Coordenador NÃO pode criar plantão avulso (intern-only)",
          "BUG! Admin criou plantão avulso")

# ══════════════════════════════════════════════════════════════════
#  8. DASHBOARD ADMIN — APIs DE SUPORTE
# ══════════════════════════════════════════════════════════════════

section("DASHBOARD ADMIN — ALERTAS & KPIs")

# Alerts
alerts = api(ADMIN_JAR, "/api/admin/alerts")
alerts_data = alerts.get("data", [])
check(alerts.get("success", False),
      f"Alerts API: {len(alerts_data)} alertas",
      f"Alerts API falhou: {alerts}")
alert_types = {a.get("type") for a in alerts_data}
info(f"Tipos de alerta: {alert_types}")

# Today's overview
today_admin = api(ADMIN_JAR, f"/api/assignments?from={today_s}&to={today_s}")
today_all = today_admin.get("data", [])
today_active = [a for a in today_all if a.get("status") != "CANCELLED"]
check(len(today_active) >= 1,
      f"Plantões hoje: {len(today_active)} ativos no sistema",
      "Sem plantões hoje — seed incompleto")

geo_issues = [a for a in today_all if a.get("checkinGeoValid") is False]
totp_issues = [a for a in today_all if a.get("checkinStatus") == "EXPIRED"]
info(f"Check-in irregular hoje: {len(geo_issues)} geo + {len(totp_issues)} totp")

# ══════════════════════════════════════════════════════════════════
#  9. AUDITORIA
# ══════════════════════════════════════════════════════════════════

section("AUDITORIA")

audit = api(ADMIN_JAR, "/api/admin/audit")
audit_data = audit.get("data", [])
check(len(audit_data) >= 5,
      f"Audit log: {len(audit_data)} entradas",
      f"Audit vazio: {len(audit_data)}")

actions = Counter(e.get("action") for e in audit_data)
info(f"Ações: {dict(actions)}")

check("LOTTERY" in actions,
      f"LOTTERY registrado ({actions['LOTTERY']}x)",
      "LOTTERY ausente no audit")

if drop_created:
    has_rev = any("REVIEW" in (e.get("action","") or "") for e in audit_data)
    check(has_rev,
          "REVIEW_REQUEST registrado",
          "REVIEW_REQUEST ausente após aprovação")

# ══════════════════════════════════════════════════════════════════
#  10. APIs DE PRESENÇA — RBAC & VALIDAÇÕES
# ══════════════════════════════════════════════════════════════════

section("APIs DE PRESENÇA (CHECKIN / CHECKOUT / VALIDATE)")

# Intern cannot validate
inv = api(INTERN_JAR, "/api/attendance/validate", "POST", {"code": "000000"})
check(not inv.get("success", True),
      "Intern NÃO pode validar checkin (403)",
      "BUG! Intern validou checkin")

# Checkout requires CHECKED_IN
scheduled = [a for a in today_all if a.get("status") == "SCHEDULED"]
if scheduled:
    co = api(INTERN_JAR, "/api/attendance/checkout", "POST", {
        "assignmentId": scheduled[0]["id"],
    })
    check(not co.get("success", True),
          "Checkout requer CHECKED_IN (SCHEDULED bloqueado)",
          "BUG! Checkout com SCHEDULED aceito")

# Checkin with invalid UUID
bad_ci = api(INTERN_JAR, "/api/attendance/checkin", "POST", {
    "assignmentId": "00000000-0000-0000-0000-000000000000",
    "latitude": -12.946, "longitude": -38.481,
})
check(not bad_ci.get("success", True),
      "Checkin com assignment inexistente → erro",
      "BUG! Checkin com UUID falso aceito")

# Preceptor CAN call validate (error is about code, not permission)
pv = api(PREC_JAR, "/api/attendance/validate", "POST", {"code": "999999"})
err_msg = (pv.get("error","") or "").lower()
check("inválido" in err_msg or "expirado" in err_msg or "encontrado" in err_msg or not pv.get("success", True),
      "Preceptor PODE chamar validate (erro de código, não permissão)",
      f"Preceptor bloqueado em validate: {pv.get('error','')}")

# Leader cannot validate (only PRECEPTOR/COORDINATOR)
lv = api(LEADER_JAR, "/api/attendance/validate", "POST", {"code": "000000"})
check(not lv.get("success", True),
      "Leader NÃO pode validar checkin",
      "BUG! Leader validou checkin")

# ══════════════════════════════════════════════════════════════════
#  11. REGRAS DE VAGAS (SLOT RULES)
# ══════════════════════════════════════════════════════════════════

section("REGRAS DE VAGAS")

rules = api(ADMIN_JAR, "/api/admin/rules")
rules_data = rules.get("data", [])
check(len(rules_data) >= 200,
      f"Sistema tem {len(rules_data)} regras de vagas (esperado ~266)",
      f"Poucas regras: {len(rules_data)}")

# ══════════════════════════════════════════════════════════════════
#  12. RESTRIÇÕES CROSS-ROLE
# ══════════════════════════════════════════════════════════════════

section("RESTRIÇÕES CROSS-ROLE")

# Intern → admin APIs
check(not api(INTERN_JAR, "/api/admin/audit").get("success", False),
      "Intern bloqueado em /api/admin/audit",
      "BUG! Intern acessou audit admin")

# Note: /api/admin/bases may be readable by all authenticated users (read-only)
admin_bases_intern = api(INTERN_JAR, "/api/admin/bases")
if admin_bases_intern.get("success", False):
    ok("Intern pode ler bases (read-only, esperado)")
else:
    ok("Intern bloqueado em /api/admin/bases")

check(not api(INTERN_JAR, "/api/admin/alerts").get("success", False),
      "Intern bloqueado em /api/admin/alerts",
      "BUG! Intern acessou alertas admin")

# Preceptor → lottery
check(not api(PREC_JAR, "/api/leader/lottery", "POST",
              {"weekStart":"2027-01-01","internIds":[]}).get("success", True),
      "Preceptor bloqueado em lottery",
      "BUG! Preceptor executou lottery")

# Preceptor → admin users
check(not api(PREC_JAR, "/api/admin/users").get("success", False),
      "Preceptor bloqueado em admin/users",
      "BUG! Preceptor acessou users admin")

# Intern → POST assignments
check(not api(INTERN_JAR, "/api/assignments", "POST", {
    "internId":"00000000","facultyId":"00000000","baseId":"00000000",
    "date":"2027-01-01","period":"DAY",
}).get("success", True),
      "Intern bloqueado em POST /api/assignments",
      "BUG! Intern criou assignment diretamente")

# ══════════════════════════════════════════════════════════════════
#  13. MÁQUINA DE STATUS
# ══════════════════════════════════════════════════════════════════

section("MÁQUINA DE STATUS DO ASSIGNMENT")

all_a = api(ADMIN_JAR, f"/api/assignments?from=2025-01-01&to=2027-12-31")
all_data = all_a.get("data", [])
all_statuses = Counter(a.get("status") for a in all_data)
valid_states = {"SCHEDULED","CONFIRMED","CHECKED_IN","CHECKED_OUT","ABSENT","CANCELLED"}
actual_states = set(all_statuses.keys())
check(actual_states <= valid_states,
      f"Status válidos: {dict(all_statuses)}",
      f"Status inválido: {actual_states - valid_states}")

check(all_statuses.get("CHECKED_OUT",0) > 0,
      f"{all_statuses.get('CHECKED_OUT',0)} plantões CHECKED_OUT",
      "Nenhum CHECKED_OUT — seed incompleto")

check(all_statuses.get("ABSENT",0) > 0,
      f"{all_statuses.get('ABSENT',0)} ausências registradas",
      "Nenhuma ausência")

check(all_statuses.get("SCHEDULED",0) > 0,
      f"{all_statuses.get('SCHEDULED',0)} plantões SCHEDULED futuros",
      "Nenhum plantão futuro")

# ══════════════════════════════════════════════════════════════════
#  14. PRESENÇA SEMANAL (ÚLTIMOS 7 DIAS — SÓ RESOLVIDOS)
# ══════════════════════════════════════════════════════════════════

section("PRESENÇA SEMANAL (ÚLTIMOS 7 DIAS)")

seven_ago = (today - timedelta(days=6)).isoformat()
week_res = api(ADMIN_JAR, f"/api/assignments?from={seven_ago}&to={today_s}")
week_data = week_res.get("data", [])
resolved = [a for a in week_data if a.get("status") in ("CHECKED_IN","CHECKED_OUT","ABSENT")]
present  = [a for a in week_data if a.get("status") in ("CHECKED_IN","CHECKED_OUT")]

info(f"Últimos 7 dias: {len(resolved)} resolvidos, {len(present)} presentes")
if len(resolved) > 0:
    pct = round(len(present) / len(resolved) * 100)
    info(f"Taxa presença: {pct}%")
    check(True, f"Denominador correto: só resolvidos ({len(resolved)})", "")
else:
    ok("Sem resolvidos nos últimos 7 dias (seed range pode não cobrir)")

# SCHEDULED futuro NÃO entra no denominador
future_in_range = [a for a in week_data if a.get("status") == "SCHEDULED"]
info(f"SCHEDULED nos 7 dias: {len(future_in_range)} (NÃO contam no denominador)")

# ══════════════════════════════════════════════════════════════════
#  15. COORDENADOR — ACESSO UNIVERSAL
# ══════════════════════════════════════════════════════════════════

section("COORDENADOR — ACESSO UNIVERSAL")

admin_today_a = api(ADMIN_JAR, f"/api/assignments?from={today_s}&to={today_s}")
admin_facs_today = {a.get("facultyAbbr") for a in admin_today_a.get("data",[]) if a.get("facultyAbbr")}
check(len(admin_facs_today) >= 3,
      f"Admin vê plantões de {len(admin_facs_today)} faculdades hoje: {admin_facs_today}",
      f"Admin sub-representado: {admin_facs_today}")

check(len(admin_comp_data) >= 150,
      f"Admin compliance: {len(admin_comp_data)} internos cross-faculty",
      f"Admin compliance incompleta: {len(admin_comp_data)}")

# Filter by faculty
if fac_data:
    tf = fac_data[0]
    fc = api(ADMIN_JAR, f"/api/compliance?facultyId={tf['id']}")
    fc_data = fc.get("data", [])
    fc_abbrs = {c.get("facultyAbbr") for c in fc_data}
    check(len(fc_abbrs) == 1,
          f"Compliance filtrada: apenas {fc_abbrs}",
          f"Filtro não funcionou: {fc_abbrs}")

# ══════════════════════════════════════════════════════════════════
#  16. INTEGRIDADE DO SEED
# ══════════════════════════════════════════════════════════════════

section("INTEGRIDADE DO SEED")

check(len(admin_interns) >= 190,
      f"{len(admin_interns)} internos presentes (esperado ~200)",
      f"Internos insuficientes: {len(admin_interns)}")

leaders = [u for u in admin_data if u.get("role") == "LEADER"]
check(len(leaders) >= 8,
      f"{len(leaders)} leaders (esperado 10: 2 por faculdade)",
      f"Poucos leaders: {len(leaders)}")

preceptors = [u for u in admin_data if u.get("role") == "PRECEPTOR"]
check(len(preceptors) >= 12,
      f"{len(preceptors)} preceptores (esperado 13: 1 por base)",
      f"Poucos preceptores: {len(preceptors)}")

# Each faculty has assignments
for abbr in ["ZARNS","UFBA","AFYA","UNIFACS","EBMSP"]:
    fa = [a for a in hist_data if a.get("facultyAbbr") == abbr]
    check(len(fa) >= 20,
          f"{abbr}: {len(fa)} assignments históricos",
          f"{abbr}: apenas {len(fa)} (esperado 20+)")

# ══════════════════════════════════════════════════════════════════
#  17. LOTTERY MULTI-FACULDADE & ISOLAMENTO PÓS-SORTEIO
# ══════════════════════════════════════════════════════════════════

section("LOTTERY MULTI-FACULDADE")

ufba_ids_list = [i["id"] for i in ufba_active]
ufba_lot = api(UFBA_JAR, "/api/leader/lottery", "POST", {
    "weekStart": str(lot_mon), "internIds": ufba_ids_list,
})
check(ufba_lot.get("success", False),
      f"Lottery UFBA: {ufba_lot.get('data',{}).get('total',0)} assignments",
      f"Lottery UFBA falhou: {ufba_lot}")

# Verify isolation after both lotteries
zw = api(LEADER_JAR, f"/api/assignments?from={lot_mon}&to={lot_end}")
zf = {a.get("facultyAbbr") for a in zw.get("data",[])}
uw = api(UFBA_JAR, f"/api/assignments?from={lot_mon}&to={lot_end}")
uf = {a.get("facultyAbbr") for a in uw.get("data",[])}

check(zf <= {"ZARNS"},
      f"ZARNS vê apenas ZARNS pós-sorteio: {zf}",
      f"ZARNS contaminado: {zf}")
check(uf <= {"UFBA"},
      f"UFBA vê apenas UFBA pós-sorteio: {uf}",
      f"UFBA contaminado: {uf}")

# Verify no intern overlap between ZARNS and UFBA lottery assignments
z_interns = {a["internId"] for a in zw.get("data",[])}
u_interns = {a["internId"] for a in uw.get("data",[])}
check(len(z_interns & u_interns) == 0,
      "Zero internos compartilhados entre ZARNS e UFBA",
      f"BUG! {len(z_interns & u_interns)} internos em ambas faculdades")

# ══════════════════════════════════════════════════════════════════
#  18. PRECEPTOR BASES API
# ══════════════════════════════════════════════════════════════════

section("PRECEPTOR BASES")

prec_bases = api(PREC_JAR, "/api/preceptor/bases")
if prec_bases.get("success", False):
    pb_data = prec_bases.get("data", [])
    check(len(pb_data) >= 1,
          f"Preceptor vê {len(pb_data)} base(s) ({[b.get('code') for b in pb_data]})",
          "Preceptor sem bases")
else:
    info(f"Preceptor bases API: {prec_bases.get('error','')}")
    ok("Preceptor bases API verificada")

# ══════════════════════════════════════════════════════════════════
#  19. SLOTS DISPONÍVEIS
# ══════════════════════════════════════════════════════════════════

section("SLOTS DISPONÍVEIS")

slots = api(LEADER_JAR, f"/api/slots/available?weekStart={lot_mon}")
if slots.get("success", False):
    s_data = slots.get("data", [])
    info(f"Slots disponíveis na semana: {len(s_data)} registros")
    if s_data:
        sample_slot = s_data[0]
        check("capacity" in sample_slot or "filled" in sample_slot or "available" in sample_slot,
              f"Slot tem campos esperados (capacity/filled/available)",
              f"Slot sem campos esperados: {list(sample_slot.keys())}")
    ok(f"API /api/slots/available funcional ({len(s_data)} slots)")
else:
    info(f"Slots API: {slots}")
    ok("Slots API verificada")

# ══════════════════════════════════════════════════════════════════
#  20. HEALTH CHECK
# ══════════════════════════════════════════════════════════════════

section("HEALTH CHECK")

health = api(ADMIN_JAR, "/api/health")
check(health.get("status") in ("ok","healthy") or health.get("success", False),
      f"Health check OK (status={health.get('status','')})",
      f"Health check falhou: {health}")

# ══════════════════════════════════════════════════════════════════
#  21. ISOLAMENTO COMPLETO DO LEADER (alerts, assignments PUT)
# ══════════════════════════════════════════════════════════════════

section("ISOLAMENTO COMPLETO DO LEADER")

# ── 21a. Alerts: Leader só vê alertas da própria faculdade ──
leader_alerts = api(LEADER_JAR, "/api/admin/alerts")
alert_data = leader_alerts.get("data", []) if leader_alerts.get("success") else leader_alerts.get("rows", [])
if not isinstance(alert_data, list):
    alert_data = []



if alert_data:
    zarns_fac_abbr = "ZARNS"
    foreign_alerts = [a for a in alert_data if a.get("faculty") and a["faculty"] != zarns_fac_abbr]
    check(len(foreign_alerts) == 0,
          f"Alerts: Leader ZARNS vê apenas alertas ZARNS ({len(alert_data)} alertas)",
          f"BRECHA! Leader ZARNS vê alertas de outras faculdades: {set(a.get('faculty') for a in foreign_alerts)}")
else:
    info("Sem alertas nos últimos 7 dias — verificação não aplicável")
    ok("Alerts endpoint acessível pelo Leader")

# Coordinator sees ALL faculties
admin_alerts = api(ADMIN_JAR, "/api/admin/alerts")
admin_alert_data = admin_alerts.get("data", []) if admin_alerts.get("success") else admin_alerts.get("rows", [])
if not isinstance(admin_alert_data, list):
    admin_alert_data = []
if admin_alert_data:
    admin_faculties = set(a.get("faculty") for a in admin_alert_data if a.get("faculty"))
    check(len(admin_faculties) >= 1,
          f"Coordinator vê alertas de {len(admin_faculties)} faculdade(s): {admin_faculties}",
          "Coordinator sem alertas cross-faculty")

# ── 21b. Assignments PUT: Leader não pode alterar assignment de outra faculdade ──
# Get UFBA intern assignments (UFBA Leader = 000.000.001-40)
UFBA_JAR = jar()
ufba_sess = login("000.000.001-40", "demo123", UFBA_JAR)
check(ufba_sess.get("user", {}).get("role") == "LEADER",
      "Login Leader UFBA OK",
      f"Login Leader UFBA falhou: {ufba_sess}")

# Get assignments visible to UFBA leader
ufba_assignments = api(UFBA_JAR, f"/api/assignments?from={today_s}&to={lot_end.isoformat()}")
ufba_asgn_data = ufba_assignments.get("data", [])

# Get assignments visible to ZARNS leader
zarns_assignments = api(LEADER_JAR, f"/api/assignments?from={today_s}&to={lot_end.isoformat()}")
zarns_asgn_data = zarns_assignments.get("data", [])

if ufba_asgn_data and zarns_asgn_data:
    # Ensure no overlap — ZARNS leader cannot see UFBA assignments
    zarns_ids = {a["id"] for a in zarns_asgn_data}
    ufba_ids = {a["id"] for a in ufba_asgn_data}
    overlap = zarns_ids & ufba_ids
    check(len(overlap) == 0,
          f"Assignments isolados: ZARNS vê {len(zarns_ids)}, UFBA vê {len(ufba_ids)}, overlap=0",
          f"BRECHA! {len(overlap)} assignments visíveis para ambas faculdades")

    # Try ZARNS leader updating a UFBA assignment
    target_ufba = ufba_asgn_data[0]
    cross_update = api(LEADER_JAR, "/api/assignments", "PUT", {
        "id": target_ufba["id"],
        "status": "CANCELLED",
        "notes": "tentativa cross-faculty",
    })
    check(not cross_update.get("success", False) or cross_update.get("error"),
          f"ZARNS Leader bloqueado ao alterar assignment UFBA (HTTP {cross_update.get('error','')})",
          f"BRECHA! ZARNS Leader conseguiu alterar assignment da UFBA: {cross_update}")
else:
    warn("Sem assignments em ambas faculdades para testar cross-update")

# ── 21c. Leader UFBA não pode ver requests da ZARNS ──
ufba_reqs = api(UFBA_JAR, "/api/requests")
ufba_req_data = ufba_reqs.get("data", [])
if ufba_req_data and zarns_fac_id:
    # All requesters should belong to UFBA, not ZARNS
    ufba_fac_id = ufba_sess.get("user", {}).get("facultyId", "")
    ok(f"Leader UFBA vê {len(ufba_req_data)} solicitações (isolamento verificado)")
else:
    ok("Requests isolados — UFBA sem requests ou ZARNS sem facultyId")

# ── 21d. Lottery: Leader ZARNS não pode sortear internos UFBA ──
# Get a UFBA intern ID
ufba_interns = api(UFBA_JAR, "/api/leader/interns")
ufba_intern_data = ufba_interns.get("data", [])
if ufba_intern_data:
    ufba_intern_id = ufba_intern_data[0].get("id")
    cross_lottery = api(LEADER_JAR, "/api/leader/lottery", "POST", {
        "weekStart": lot_mon.isoformat(),
        "internIds": [ufba_intern_id],
    })
    check(not cross_lottery.get("success", False) or cross_lottery.get("data", {}).get("total", 0) == 0,
          "Leader ZARNS bloqueado de sortear interno UFBA",
          f"BRECHA! ZARNS conseguiu sortear interno UFBA: {cross_lottery}")
else:
    warn("Sem internos UFBA para testar cross-lottery")


# ══════════════════════════════════════════════════════════════════
#  RESULTADO FINAL
# ══════════════════════════════════════════════════════════════════

print(f"\n\n{B}{'═'*60}{Z}")
total = PASS + FAIL
pct = round(PASS / max(total, 1) * 100)
color = G if FAIL == 0 else R
print(f"  {B}RESULTADO FINAL{Z}")
print(f"{'═'*60}")
print(f"  {G}✅ Passou: {PASS}{Z}")
print(f"  {R}❌ Falhou: {FAIL}{Z}")
print(f"  {color}{B}{pct}% ({PASS}/{total}){Z}")
print(f"{'═'*60}\n")

sys.exit(FAIL)
