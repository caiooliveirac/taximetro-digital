import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors",
  {
    variants: {
      variant: {
        default: "bg-accent-50 text-accent-700 ring-accent-600/20",
        confirmed: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
        pending: "bg-amber-50 text-amber-700 ring-amber-600/20",
        absent: "bg-red-50 text-red-700 ring-red-600/20",
        excused: "bg-violet-50 text-violet-700 ring-violet-600/20",
        scheduled: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
        cancelled: "bg-slate-100 text-slate-500 ring-slate-400/20",
        checkedin: "bg-sky-50 text-sky-700 ring-sky-600/20",
        checkedout: "bg-blue-50 text-blue-700 ring-blue-600/20",
        destructive: "bg-red-50 text-red-700 ring-red-600/20",
        outline: "bg-transparent text-slate-700 ring-slate-300",
        secondary: "bg-slate-100 text-slate-700 ring-slate-300/20",
        usa: "bg-red-50 text-red-700 ring-red-600/20",

        central: "bg-purple-50 text-purple-700 ring-purple-600/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
