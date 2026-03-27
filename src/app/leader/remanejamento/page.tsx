import { RemanejamentoPanel } from "@/components/remanejamento-panel";

export default async function LeaderRemanejamentoPage({
    searchParams,
}: {
    searchParams: Promise<{ assignmentId?: string }>;
}) {
    const params = await searchParams;
    return <RemanejamentoPanel scope="leader" highlightedAssignmentId={params.assignmentId} />;
}