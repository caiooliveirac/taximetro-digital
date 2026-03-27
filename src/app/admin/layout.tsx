"use client";

import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import {
  LayoutDashboard,
  CheckCircle,
  Calendar,
  ArrowRightLeft,
  Building2,
  GraduationCap,
  Users,
  ClipboardList,
  FileSearch,
  Eye,
  BarChart3,
} from "lucide-react";

const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/presencas", label: "Presenças", icon: CheckCircle },
  { href: "/admin/escalas", label: "Grade", icon: Calendar },
  { href: "/admin/remanejamento", label: "Remanejamento", icon: ArrowRightLeft },
  { href: "/admin/ver-interno", label: "Ver Interno", icon: Eye },
  { href: "/admin/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/admin/bases", label: "Bases", icon: Building2 },
  { href: "/admin/faculdades", label: "Faculdades", icon: GraduationCap },
  { href: "/admin/usuarios", label: "Usuários", icon: Users },
  { href: "/admin/solicitacoes", label: "Solicitações", icon: ClipboardList },
  { href: "/admin/audit", label: "Atividades", icon: FileSearch },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <AppSidebar
        nav={NAV}
        role="Coordenação"
        navGroups={[
          { label: "Operação", items: NAV.slice(0, 6) },
          { label: "Estrutura", items: NAV.slice(6, 9) },
          { label: "Governança", items: NAV.slice(9) },
        ]}
      />
      <main className="flex-1 p-4 lg:p-6 pb-20 lg:pb-6">{children}</main>
    </div>
  );
}
