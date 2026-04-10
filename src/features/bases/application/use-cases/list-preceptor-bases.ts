import { listActiveBases } from "@/features/bases/infra/repositories/base-repository";

export async function executeListPreceptorBases() {
  return listActiveBases();
}
