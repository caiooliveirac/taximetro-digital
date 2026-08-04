import { getCohortById } from "@/features/cohorts/infra/repositories/cohort-repository";
import {
  findUserByCpfOrEmail,
  createUserFromImport,
  findUserRole,
  createUserRoleForCohort,
} from "@/features/cohorts/infra/repositories/cohort-repository";

type SamuRosterEntry = {
  role: "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN";
  name: string;
  cpf: string | null;
  email: string;
  phone: string | null;
  passwordHash: string;
  forcePasswordChange: boolean;
};

function samuApiHeaders() {
  const secret = process.env.CROSS_APP_IMPORT_SECRET;
  if (!secret) throw new Error("CROSS_APP_IMPORT_SECRET não configurado");
  return { "x-import-secret": secret };
}

function samuBaseUrl() {
  const url = process.env.SAMU_API_URL;
  if (!url) throw new Error("SAMU_API_URL não configurado");
  return url;
}

export async function fetchSamuUnifacsCohorts() {
  const res = await fetch(
    `${samuBaseUrl()}/taximetro/api/internal/cohorts?facultyAbbreviation=UNIFACS`,
    { headers: samuApiHeaders() },
  );
  if (!res.ok) throw new Error(`SAMU respondeu ${res.status} ao listar turmas`);
  const json = await res.json();
  return json.data as {
    id: string;
    label: string;
    rotationNumber: number;
    startDate: string;
    endDate: string;
    status: string;
  }[];
}

async function fetchSamuRoster(samuCohortId: string) {
  const res = await fetch(
    `${samuBaseUrl()}/taximetro/api/internal/cohorts/${samuCohortId}/roster`,
    { headers: samuApiHeaders() },
  );
  if (!res.ok) throw new Error(`SAMU respondeu ${res.status} ao buscar a turma`);
  const json = await res.json();
  return json.data as SamuRosterEntry[];
}

export async function executeImportFromSamu(params: { cohortId: string; samuCohortId: string }) {
  const cohort = await getCohortById(params.cohortId);
  if (!cohort) {
    return { status: 404, body: { success: false, error: "Turma não encontrada" } } as const;
  }

  let roster: SamuRosterEntry[];
  try {
    roster = await fetchSamuRoster(params.samuCohortId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 502, body: { success: false, error: msg } } as const;
  }

  let created = 0;
  let linked = 0;
  const errors: { name: string; error: string }[] = [];

  for (const entry of roster) {
    try {
      let user = await findUserByCpfOrEmail(entry.cpf, entry.email);
      if (!user) {
        user = await createUserFromImport({
          name: entry.name,
          cpf: entry.cpf,
          email: entry.email,
          phone: entry.phone,
          passwordHash: entry.passwordHash,
          forcePasswordChange: entry.forcePasswordChange,
        });
        created++;
      }

      const existingRole = await findUserRole(user.id, entry.role, cohort.facultyId);
      if (existingRole) {
        linked++;
        continue;
      }

      await createUserRoleForCohort({
        userId: user.id,
        role: entry.role,
        facultyId: cohort.facultyId,
        cohortId: cohort.id,
      });
      linked++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ name: entry.name, error: msg });
    }
  }

  return { status: 200, body: { success: true, data: { created, linked, errors } } } as const;
}
