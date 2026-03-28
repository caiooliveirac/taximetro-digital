import { AbsencesView } from "@/components/absences-view";

export default function LeaderFaltasPage() {
    return (
        <AbsencesView
            scope="leader"
            title="Faltas"
            description="Ausências da sua faculdade, com leitura operacional do que precisa justificar, acompanhar ou repor na escala."
        />
    );
}