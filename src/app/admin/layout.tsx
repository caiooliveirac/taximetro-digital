"use client";

import { AppSidebar, type NavItem } from "@/components/app-sidebar";
import {
  LayoutDashboard,
  CheckCircle,
  XCircle,
  Calendar,
  LayoutGrid,
  TableProperties,
  ArrowRightLeft,
  Building2,
  GraduationCap,
  Users,
  ClipboardList,
  FileSearch,
  Eye,
  BarChart3,
  Zap,
  BookOpen,
} from "lucide-react";

const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/presencas", label: "Presenças", icon: CheckCircle },
  { href: "/admin/faltas", label: "Faltas", icon: XCircle },
  { href: "/admin/escalas/grade", label: "Grade", icon: LayoutGrid },
  { href: "/admin/escalas/usa", label: "Escala USA", icon: Calendar },
  { href: "/admin/escalas/cru", label: "Escala CRU", icon: TableProperties },
  { href: "/admin/escalas/crl", label: "Escala CRL", icon: Building2 },
  { href: "/admin/remanejamento", label: "Remanejamento", icon: ArrowRightLeft },
  { href: "/admin/ver-interno", label: "Ver Interno", icon: Eye },
  { href: "/admin/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/admin/bases", label: "Bases", icon: Building2 },
  { href: "/admin/faculdades", label: "Faculdades", icon: GraduationCap },
  { href: "/admin/turmas", label: "Turmas", icon: BookOpen },
  { href: "/admin/usuarios", label: "Usuários", icon: Users },
  { href: "/admin/solicitacoes", label: "Solicitações", icon: ClipboardList },
  { href: "/admin/audit", label: "Atividades", icon: FileSearch },
  { href: "/admin/plantoes-extras", label: "Extras", icon: Zap },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <AppSidebar
        nav={NAV}
        role="Coordenação"
        navGroups={[
          { label: "Operação", items: NAV.slice(0, 11) },
          { label: "Estrutura", items: NAV.slice(11, 15) },
          { label: "Governança", items: NAV.slice(15) },
        ]}
      />
      <main className="flex-1 p-4 lg:p-6 pb-20 lg:pb-6">{children}</main>
    </div>
  );
}
