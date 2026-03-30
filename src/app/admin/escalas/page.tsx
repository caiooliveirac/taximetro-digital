import { redirect } from "next/navigation";

type Rule = {
  id: string; baseId: string; baseCode: string; baseName: string;
  dayOfWeek: string; period: string; facultyId: string; facultyAbbr: string;
  capacity: number; isActive: boolean;
};
type Base = { id: string; code: string; name: string; type: string; isActive?: boolean };
type Faculty = { id: string; abbreviation: string; name: string };

type EditState = {
  baseId: string; baseCode: string; dayOfWeek: string; period: string;
  facultyId: string; capacity: number; ruleId?: string;
};

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const DAY_LABELS: Record<string, string> = { MON: "Seg", TUE: "Ter", WED: "Qua", THU: "Qui", FRI: "Sex", SAT: "Sáb", SUN: "Dom" };
const DAY_SHORT: Record<string, string> = { MON: "S", TUE: "T", WED: "Q", THU: "Q", FRI: "S", SAT: "S", SUN: "D" };

export default function AdminEscalas() {
  redirect("/admin/escalas/usa");
}
