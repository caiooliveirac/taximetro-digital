"use client";

import { usePathname } from "next/navigation";
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
import { escalasDaInstancia } from "@/lib/instance";

// Ícone de cada escala por slug — o rótulo vem da instância (SAMU: USA/CRU/CRL,
// Vitalmed: APH/CCO, sem CRL). Ver src/lib/instance.ts.
const ICONE_ESCALA = { usa: Calendar, cru: TableProperties, crl: Building2 } as const;

const ESCALAS_NAV: NavItem[] = escalasDaInstancia().map(({ slug, label }) => ({
  href: `/admin/escalas/${slug}`,
  label,
  icon: ICONE_ESCALA[slug],
}));

// Grupos declarados explicitamente. Antes eram fatias por índice (slice(0,10)…),
// o que quebraria silenciosamente agora que o número de escalas varia por
// instância — item do grupo errado, sem erro nenhum aparecendo.
const NAV_OPERACAO: NavItem[] = [
  { href: "/admin", label: "Cockpit", icon: LayoutDashboard },
  { href: "/admin/presencas", label: "Presenças", icon: CheckCircle },
  { href: "/admin/faltas", label: "Faltas", icon: XCircle },
  { href: "/admin/escalas/grade", label: "Grade", icon: LayoutGrid },
  ...ESCALAS_NAV,
  { href: "/admin/remanejamento", label: "Remanejamento", icon: ArrowRightLeft },
  { href: "/admin/ver-interno", label: "Ver Interno", icon: Eye },
  { href: "/admin/relatorios", label: "Relatórios", icon: BarChart3 },
];

const NAV_ESTRUTURA: NavItem[] = [
  { href: "/admin/bases", label: "Bases", icon: Building2 },
  { href: "/admin/faculdades", label: "Faculdades", icon: GraduationCap },
  { href: "/admin/turmas", label: "Turmas", icon: BookOpen },
  { href: "/admin/usuarios", label: "Usuários", icon: Users },
  { href: "/admin/solicitacoes", label: "Solicitações", icon: ClipboardList },
];

const NAV_GOVERNANCA: NavItem[] = [
  { href: "/admin/audit", label: "Atividades", icon: FileSearch },
  { href: "/admin/plantoes-extras", label: "Extras", icon: Zap },
];

const NAV: NavItem[] = [...NAV_OPERACAO, ...NAV_ESTRUTURA, ...NAV_GOVERNANCA];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Rota de exportação de relatórios é renderizada "nua" (sem sidebar) para que
  // o usuário possa imprimir/salvar como PDF sem capturar a barra lateral.
  if (pathname === "/admin/relatorios/export") {
    return <main className="min-h-screen bg-white">{children}</main>;
  }

  return (
    <div className="flex min-h-screen">
      <AppSidebar
        nav={NAV}
        role="Coordenação"
        navGroups={[
          { label: "Operação", items: NAV_OPERACAO },
          { label: "Estrutura", items: NAV_ESTRUTURA },
          { label: "Governança", items: NAV_GOVERNANCA },
        ]}
      />
      {/* min-w-0: sem isso, conteúdo largo (grades) estica o main além do viewport
          em vez de rolar dentro dos containers overflow-x-auto */}
      <main className="min-w-0 flex-1 p-4 lg:p-6 pb-20 lg:pb-6">{children}</main>
    </div>
  );
}
