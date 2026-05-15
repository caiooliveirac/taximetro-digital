"use client";

import { useRouter } from "next/navigation";
import { X, ArrowRight } from "lucide-react";
import { getFacultyStyle } from "@/lib/base-colors";
import { InternHistorySection, useInternHistory, COMPLIANCE_BADGE } from "@/components/admin/intern-history-section";

export function InternQuickModal({
  internId,
  internName,
  facultyAbbr,
  onClose,
}: {
  internId: string;
  internName: string;
  facultyAbbr: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const history = useInternHistory(internId);
  const { compliance } = history;
  const fst = getFacultyStyle(facultyAbbr);

  function goToFullProfile() {
    router.push(`/admin/ver-interno?internId=${internId}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 animate-[fadeInUp_120ms_ease-out]"
      onClick={onClose}
    >
      <div
        className="relative max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-lg font-semibold text-slate-900">{internName}</h3>
              {facultyAbbr && (
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${fst.pill}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                  {facultyAbbr}
                </span>
              )}
              {compliance && (
                <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${COMPLIANCE_BADGE[compliance.status].pill}`}>
                  {COMPLIANCE_BADGE[compliance.status].label}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">Resumo rápido — clique em &quot;Ver perfil completo&quot; para gerir o interno</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-6 py-4">
          <InternHistorySection data={history} />
        </div>

        <div className="border-t border-slate-100 bg-slate-50 px-6 py-3">
          <button
            onClick={goToFullProfile}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 active:scale-[0.99]"
          >
            Ver perfil completo
            <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
