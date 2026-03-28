import { AbsencesView } from "@/components/absences-view";

export default function AdminFaltasPage() {
    return (
        <AbsencesView
            scope="admin"
            title="Faltas"
            description="Visão dedicada das ausências registradas, com justificativa, prioridade de ação e atalho para recompor cobertura."
        />
    );
}