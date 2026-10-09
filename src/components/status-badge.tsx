import { Home } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";
import { ehReposicao } from "@/lib/plantao-ao-vivo";
import type { badgeVariants } from "@/components/ui/badge";

const STATUS_MAP: Record<string, { label: string; variant: VariantProps<typeof badgeVariants>["variant"] }> = {
  SCHEDULED: { label: "Agendado", variant: "scheduled" },
  CONFIRMED: { label: "Confirmado", variant: "confirmed" },
  CHECKED_IN: { label: "Check-in", variant: "checkedin" },
  CHECKED_OUT: { label: "Check-out", variant: "checkedout" },
  ABSENT: { label: "Ausente", variant: "absent" },
  EXCUSED: { label: "Falta abonada", variant: "excused" },
  CANCELLED: { label: "Cancelado", variant: "cancelled" },
  PENDING: { label: "Pendente", variant: "pending" },
  APPROVED: { label: "Aprovado", variant: "confirmed" },
  REJECTED: { label: "Rejeitado", variant: "absent" },
  VALIDATED: { label: "Validado", variant: "confirmed" },
  EXPIRED: { label: "Expirado", variant: "absent" },
};

/**
 * `notes` é opcional: com ele, o plantão cancelado que a coordenação mandou
 * para casa (base desativada, sem remanejamento) aparece como "Em casa", em
 * laranja, e não como falta nem como cancelamento comum.
 */
export function StatusBadge({ status, notes }: { status: string; notes?: string | null }) {
  if (status === "CANCELLED" && ehReposicao(notes)) {
    return (
      <Badge variant="casa" className="gap-1">
        <Home className="h-3 w-3" strokeWidth={2} /> Em casa
      </Badge>
    );
  }
  const mapped = STATUS_MAP[status];
  return (
    <Badge variant={mapped?.variant ?? "outline"}>
      {mapped?.label ?? status}
    </Badge>
  );
}
