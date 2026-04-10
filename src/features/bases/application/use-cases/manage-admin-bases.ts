import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  calibrateBaseCoords,
  createBase,
  findBaseById,
  listAllBases,
  updateBaseById,
} from "@/features/bases/infra/repositories/base-repository";

export const adminBaseSchema = z.object({
  code: z.string().min(2).max(10),
  name: z.string().min(2).max(100),
  type: z.enum(["USA", "CENTRAL", "CRL"]),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  geoFenceMeters: z.number().int().min(50).max(2000).default(200),
  isActive: z.boolean().default(true),
});

export const calibrateBaseSchema = z.object({
  baseId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export async function executeListAdminBases() {
  return listAllBases();
}

export async function executeCreateBase(params: {
  actorUserId: string;
  input: z.infer<typeof adminBaseSchema>;
}) {
  const created = await createBase(params.input);

  await logAudit({
    userId: params.actorUserId,
    action: "CREATE_BASE",
    entity: "base",
    entityId: created.id,
    payload: params.input,
  });

  return { status: 201, body: { success: true, data: created } } as const;
}

export async function executeUpdateBase(params: {
  actorUserId: string;
  baseId: string;
  input: Partial<z.infer<typeof adminBaseSchema>>;
}) {
  const updated = await updateBaseById({ id: params.baseId, values: params.input });
  if (!updated) return { status: 404, body: { success: false, error: "Base não encontrada" } } as const;

  await logAudit({
    userId: params.actorUserId,
    action: "UPDATE_BASE",
    entity: "base",
    entityId: params.baseId,
    payload: params.input,
  });

  return { status: 200, body: { success: true, data: updated } } as const;
}

export async function executeCalibrateBase(params: {
  actorUserId: string;
  input: z.infer<typeof calibrateBaseSchema>;
}) {
  const base = await findBaseById(params.input.baseId);
  if (!base) return { status: 404, body: { success: false, error: "Base não encontrada" } } as const;

  const updated = await calibrateBaseCoords(params.input);

  await logAudit({
    userId: params.actorUserId,
    action: "CALIBRATE_BASE",
    entity: "base",
    entityId: params.input.baseId,
    payload: {
      oldLat: base.latitude,
      oldLng: base.longitude,
      newLat: params.input.latitude,
      newLng: params.input.longitude,
    },
  });

  return { status: 200, body: { success: true, data: updated } } as const;
}
