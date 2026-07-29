import { AdminFilledSchedule } from "@/components/admin-filled-schedule";
import { AdminLotteryButton } from "@/components/admin/admin-lottery-button";
import { temFeature } from "@/lib/instance";

export default function AdminEscalasUsaPage() {
    // Sorteio pela tela do admin só existe na Vitalmed. No SAMU o sorteio é do
    // líder — aqui o botão não é renderizado, e /api/admin/lottery responde 404.
    const podeSortear = temFeature("adminLottery");

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Escala USA</h1>
                    <p className="text-sm text-slate-500">Acesso direto à operação semanal das bases USA, sem carregar CRU, CRL ou a grade de regras.</p>
                </div>
                {podeSortear && <AdminLotteryButton />}
            </div>
            <AdminFilledSchedule scope="usa" />
        </div>
    );
}