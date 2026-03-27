import { RemanejamentoPanel } from "@/components/remanejamento-panel";

export default async function AdminRemanejamentoPage({
    searchParams,
}: {
    searchParams: Promise<{ assignmentId?: string }>;
}) {
    const params = await searchParams;
    return <RemanejamentoPanel scope="admin" highlightedAssignmentId={params.assignmentId} />;
}