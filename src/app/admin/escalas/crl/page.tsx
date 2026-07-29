import { AdminFilledSchedule } from "@/components/admin-filled-schedule";
import { exigirEscala } from "@/lib/feature-gate";

export default function AdminEscalasCrlPage() {
    // A Vitalmed não tem CRL. Bloqueio no servidor: tirar do menu não impede
    // quem digitar a URL na barra de endereço.
    exigirEscala("crl");
    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-2xl font-bold text-slate-900">Escala CRL</h1>
                <p className="text-sm text-slate-500">Atalho dedicado para a CRL, separado da CRU e das bases USA para abrir mais rápido e reduzir ruído visual.</p>
            </div>
            <AdminFilledSchedule scope="crl" />
        </div>
    );
}