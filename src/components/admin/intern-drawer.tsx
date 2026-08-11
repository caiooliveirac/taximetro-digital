"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X, ArrowRight } from "lucide-react";
import { getFacultyStyle } from "@/lib/base-colors";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { InternHistorySection, useInternHistory, COMPLIANCE_BADGE } from "@/components/admin/intern-history-section";

// Drawer universal do interno: mesma janela em qualquer tela onde se clique
// num interno (escalas, faltas, presenças, montar escala, dashboards).
// O miolo (velocímetro, KPIs, faltas, plantões, ocorrências) vem do
// InternHistorySection; ações completas ficam no /admin/ver-interno.
export function InternDrawer({
  internId,
  internName,
  facultyAbbr,
  onClose,
}: {
  internId: string;
  internName?: string;
  facultyAbbr?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Na área do líder o perfil completo é /leader/internos; no admin, /admin/ver-interno.
  const profileHref = pathname?.startsWith("/leader")
    ? `/leader/internos?internId=${internId}`
    : `/admin/ver-interno?internId=${internId}`;
  const history = useInternHistory(internId);
  const { compliance } = history;
  const [photoFailed, setPhotoFailed] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  const name = compliance?.name ?? internName ?? "Interno";
  const abbr = compliance?.facultyAbbr ?? facultyAbbr ?? null;
  const photoSrc = `/taximetro/api/admin/users/${internId}/selfie`;

  useEffect(() => {
    setPhotoFailed(false);
    setLightbox(false);
  }, [internId]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !lightbox) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhes de ${name}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl sm:max-w-lg"
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          {photoFailed ? (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-base font-medium text-slate-400">
              {name.charAt(0)}
            </div>
          ) : (
            <img
              src={photoSrc}
              alt={`Foto de ${name}`}
              onError={() => setPhotoFailed(true)}
              onClick={() => setLightbox(true)}
              className="h-11 w-11 shrink-0 cursor-zoom-in rounded-full object-cover ring-2 ring-slate-200"
            />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-semibold text-slate-900">{name}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {abbr && (() => {
                const fst = getFacultyStyle(abbr);
                return (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fst.pill}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                    {abbr}
                  </span>
                );
              })()}
              {compliance && (
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${COMPLIANCE_BADGE[compliance.status].pill}`}>
                  {COMPLIANCE_BADGE[compliance.status].label}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <InternHistorySection data={history} />
        </div>

        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
          <button
            onClick={() => router.push(profileHref)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 active:scale-[0.99]"
          >
            Abrir no Ver Interno (ações)
            <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </aside>

      {lightbox && !photoFailed && (
        <PhotoLightbox src={photoSrc} alt={`Foto de ${name}`} onClose={() => setLightbox(false)} />
      )}
    </>
  );
}
