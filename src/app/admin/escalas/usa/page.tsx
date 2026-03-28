import { AdminFilledSchedule } from "@/components/admin-filled-schedule";

export default function AdminEscalasUsaPage() {
    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-2xl font-bold text-slate-900">Escala USA</h1>
                <p className="text-sm text-slate-500">Acesso direto à operação semanal das bases USA, sem carregar CRU, CRL ou a grade de regras.</p>
            </div>
            <AdminFilledSchedule scope="usa" />
        </div>
    );
}