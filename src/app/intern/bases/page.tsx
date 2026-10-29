import { eq } from "drizzle-orm";
import { MapPin } from "lucide-react";
import { BasesMap } from "@/components/intern/bases-map";
import { db } from "@/db";
import { bases } from "@/db/schema";
import { baseViewIndex, type BaseType } from "@/lib/base-colors";

export const dynamic = "force-dynamic";

const TYPE_ORDER: BaseType[] = ["USA", "CENTRAL", "CRL"];

type BaseCard = {
    id: string;
    code: string;
    name: string;
    type: BaseType;
    latitude: number;
    longitude: number;
};

function sortBases(left: BaseCard, right: BaseCard) {
    const typeDelta = TYPE_ORDER.indexOf(left.type) - TYPE_ORDER.indexOf(right.type);
    if (typeDelta !== 0) return typeDelta;

    const viewDelta = baseViewIndex(left.code) - baseViewIndex(right.code);
    if (viewDelta !== 0) return viewDelta;

    return left.code.localeCompare(right.code, "pt-BR");
}

export default async function InternBasesPage() {
    const rows = await db
        .select({
            id: bases.id,
            code: bases.code,
            name: bases.name,
            type: bases.type,
            latitude: bases.latitude,
            longitude: bases.longitude,
        })
        .from(bases)
        .where(eq(bases.isActive, true));

    const ordered = [...rows].sort(sortBases);
    const comLocal = ordered.filter((base) => base.latitude !== 0 && base.longitude !== 0);
    const semLocal = ordered.filter((base) => base.latitude === 0 || base.longitude === 0);

    return (
        <div className="mx-auto max-w-lg space-y-4">
            <section className="flex items-start gap-3 px-1">
                <div className="rounded-2xl bg-accent-50 p-2.5 text-accent-600">
                    <MapPin className="h-5 w-5" strokeWidth={1.7} />
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-3">
                        <h1 className="text-2xl font-semibold text-slate-900">Bases</h1>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                            {ordered.length} locais
                        </span>
                    </div>
                    <p className="text-sm text-slate-500">
                        Toque numa base e saia daqui para lá pelo Maps, Waze ou Uber.
                    </p>
                </div>
            </section>

            {ordered.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <p className="text-sm text-slate-500">Nenhuma base ativa disponível no momento.</p>
                </div>
            ) : (
                // Chave de navegador restrita por referrer a mnrs.com.br; sem ela (Vitalmed, dev) o mapa é Leaflet.
                <BasesMap bases={comLocal} mapsKey={process.env.GOOGLE_MAPS_BROWSER_KEY || null} />
            )}

            {semLocal.length > 0 ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                    Sem localização cadastrada: {semLocal.map((base) => base.code).join(", ")}.
                </p>
            ) : null}
        </div>
    );
}
