import { Badge } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";
import type { badgeVariants } from "@/components/ui/badge";

const STATUS_MAP: Record<string, { label: string; variant: VariantProps<typeof badgeVariants>["variant"] }> = {
  SCHEDULED: { label: "Agendado", variant: "scheduled" },
  CONFIRMED: { label: "Confirmado", variant: "confirmed" },
  CHECKED_IN: { label: "Check-in", variant: "checkedin" },
  CHECKED_OUT: { label: "Check-out", variant: "checkedout" },
  ABSENT: { label: "Ausente", variant: "absent" },
  CANCELLED: { label: "Cancelado", variant: "cancelled" },
  PENDING: { label: "Pendente", variant: "pending" },
  APPROVED: { label: "Aprovado", variant: "confirmed" },
  REJECTED: { label: "Rejeitado", variant: "absent" },
  VALIDATED: { label: "Validado", variant: "confirmed" },
  EXPIRED: { label: "Expirado", variant: "absent" },
};

export function StatusBadge({ status }: { status: string }) {
  const mapped = STATUS_MAP[status];
  return (
    <Badge variant={mapped?.variant ?? "outline"}>
      {mapped?.label ?? status}
    </Badge>
  );
}
