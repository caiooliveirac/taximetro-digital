import { eq } from "drizzle-orm";
import { MapPin } from "lucide-react";
import { NavigationLinks } from "@/components/navigation-links";
import { db } from "@/db";
import { bases } from "@/db/schema";
import { baseViewIndex, getBaseStyle, type BaseType } from "@/lib/base-colors";

export const dynamic = "force-dynamic";

const TYPE_ORDER: BaseType[] = ["USA", "CENTRAL", "CRL"];

const TYPE_LABEL: Record<BaseType, string> = {
    USA: "USA",
    CENTRAL: "Central",
    CRL: "CRL",
};

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
    const sections = TYPE_ORDER
        .map((type) => ({
            type,
            label: TYPE_LABEL[type],
            items: ordered.filter((base) => base.type === type),
        }))
        .filter((section) => section.items.length > 0);

    return (
        <div className="mx-auto max-w-lg space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-accent-50 p-2.5 text-accent-600">
                        <MapPin className="h-5 w-5" strokeWidth={1.7} />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-3">
                            <h1 className="text-2xl font-semibold text-slate-900">Bases</h1>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                                {ordered.length} locais
                            </span>
                        </div>
                        <p className="text-sm text-slate-500">
                            Abra a rota direto no Maps, Waze ou Uber para qualquer base ativa.
                        </p>
                    </div>
                </div>
            </section>

            {sections.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <p className="text-sm text-slate-500">Nenhuma base ativa disponivel no momento.</p>
                </div>
            ) : (
                sections.map((section) => {
                    const sectionStyle = getBaseStyle(section.type);

                    return (
                        <section key={section.type} className="space-y-3">
                            <div className="flex items-center gap-2 px-1">
                                <span className={`inline-block h-2.5 w-2.5 rounded-full ${sectionStyle.dot}`} />
                                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{section.label}</h2>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                                    {section.items.length}
                                </span>
                            </div>

                            <div className="space-y-3">
                                {section.items.map((base) => {
                                    const baseStyle = getBaseStyle(base.type);
                                    const hasCoordinates = base.latitude !== 0 && base.longitude !== 0;

                                    return (
                                        <article
                                            key={base.id}
                                            className={`rounded-2xl border bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${baseStyle.border}`}
                                        >
                                            <div className="min-w-0 space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${baseStyle.dot}`} />
                                                    <h3 className="text-lg font-semibold text-slate-900">{base.code}</h3>
                                                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${baseStyle.pill}`}>
                                                        {TYPE_LABEL[base.type]}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-slate-500">{base.name}</p>
                                            </div>

                                            <div className="mt-4">
                                                {hasCoordinates ? (
                                                    <NavigationLinks
                                                        latitude={base.latitude}
                                                        longitude={base.longitude}
                                                        label={`${base.code} - ${base.name}`}
                                                        showHeader={false}
                                                        className="border-none bg-transparent p-0"
                                                    />
                                                ) : (
                                                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                                                        Localizacao indisponivel para esta base no momento.
                                                    </div>
                                                )}
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        </section>
                    );
                })
            )}
        </div>
    );
}