import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type Severity = "default" | "success" | "warning" | "danger";

const SEVERITY_STYLES: Record<Severity, { border: string; iconBg: string; iconColor: string }> = {
  default: { border: "", iconBg: "bg-slate-100", iconColor: "text-slate-600" },
  success: { border: "", iconBg: "bg-emerald-50", iconColor: "text-emerald-600" },
  warning: { border: "border-l-3 border-l-amber-400", iconBg: "bg-amber-50", iconColor: "text-amber-600" },
  danger:  { border: "border-l-3 border-l-red-500", iconBg: "bg-red-50", iconColor: "text-red-600" },
};

export function MetricCard({
  label,
  value,
  icon: Icon,
  sub,
  trend,
  severity = "default",
  className,
  onClick,
}: {
  label: string;
  value: number | string;
  icon?: LucideIcon;
  sub?: string;
  trend?: { direction: "up" | "down"; text: string } | "up" | "down";
  severity?: Severity;
  className?: string;
  onClick?: () => void;
}) {
  const s = SEVERITY_STYLES[severity];
  const trendDir = typeof trend === "string" ? trend : trend?.direction;
  const trendText = typeof trend === "object" && trend !== null && "text" in trend ? trend.text : undefined;

  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-px",
        s.border,
        onClick && "cursor-pointer",
        className
      )}
    >
      <div className="flex items-start justify-between">
        {Icon && (
          <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", s.iconBg)}>
            <Icon className={cn("h-[18px] w-[18px]", s.iconColor)} strokeWidth={1.5} />
          </div>
        )}
        {trendDir && (
          <span className={cn("text-xs font-medium", trendDir === "up" ? "text-emerald-600" : "text-red-600")}>
            {trendDir === "up" ? "↑" : "↓"} {trendText}
          </span>
        )}
      </div>
      <p className="mt-3 text-[12px] font-medium text-slate-500 uppercase tracking-wider">{label}</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[2.25rem] leading-tight font-bold text-slate-900 tabular-nums">{value}</span>
        {sub && <span className="text-sm text-slate-400">{sub}</span>}
      </div>
    </div>
  );
}
