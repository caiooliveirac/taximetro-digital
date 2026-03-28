import { AdminFilledSchedule } from "@/components/admin-filled-schedule";

export default function AdminEscalasCruPage() {
    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-2xl font-bold text-slate-900">Escala CRU</h1>
                <p className="text-sm text-slate-500">Atalho dedicado para a regulação da CRU, isolado da grade geral para acesso mais leve e direto.</p>
            </div>
            <AdminFilledSchedule scope="cru" />
        </div>
    );
}