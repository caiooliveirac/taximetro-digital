"use client";

import { useState } from "react";
import { History, Mail, MessageCircle, Phone } from "lucide-react";
import { getFacultyStyle } from "@/lib/base-colors";
import { whatsappLink } from "@/lib/whatsapp";
import { PhotoLightbox } from "@/components/photo-lightbox";

/**
 * Cabeçalho do interno nos modais de plantão: foto, faculdade, WhatsApp
 * pessoal, telefone e e-mail à vista — sem precisar abrir o "Ver interno".
 * Quem usa passa key={internId} para zerar foto/lightbox ao trocar de interno.
 */
export function InternContactCard({
    internId,
    name,
    facultyAbbr,
    phone,
    email,
    subtitle,
    onOpenHistory,
}: {
    internId: string;
    name: string;
    facultyAbbr?: string | null;
    phone?: string | null;
    email?: string | null;
    subtitle?: string;
    onOpenHistory?: () => void;
}) {
    const [photoFailed, setPhotoFailed] = useState(false);
    const [lightbox, setLightbox] = useState(false);
    const photoSrc = `/taximetro/api/admin/users/${internId}/selfie`;
    const whatsapp = whatsappLink(phone);
    const fst = facultyAbbr ? getFacultyStyle(facultyAbbr) : null;

    return (
        <div className="flex items-start gap-4">
            {photoFailed ? (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-2xl font-semibold text-slate-400">
                    {name.charAt(0)}
                </div>
            ) : (
                <img
                    src={photoSrc}
                    alt={`Foto de ${name}`}
                    onError={() => setPhotoFailed(true)}
                    onClick={() => setLightbox(true)}
                    className="h-20 w-20 shrink-0 cursor-zoom-in rounded-2xl object-cover object-top ring-1 ring-slate-200"
                />
            )}
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold leading-tight text-slate-900">{name}</h3>
                    {fst && (
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fst.pill}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                            {facultyAbbr}
                        </span>
                    )}
                </div>
                {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    {whatsapp && (
                        <a
                            href={whatsapp}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1ebe5a] active:scale-[0.98]"
                        >
                            <MessageCircle className="h-4 w-4" strokeWidth={2.2} /> WhatsApp
                        </a>
                    )}
                    {onOpenHistory && (
                        <button
                            type="button"
                            onClick={onOpenHistory}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                            <History className="h-4 w-4" /> Histórico
                        </button>
                    )}
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-slate-600">
                    {phone && (
                        <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-1.5 hover:text-slate-900">
                            <Phone className="h-3.5 w-3.5 text-slate-400" /> {phone}
                        </a>
                    )}
                    {email && (
                        <a href={`mailto:${email}`} className="flex min-w-0 items-center gap-1.5 hover:text-slate-900">
                            <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" /> <span className="truncate">{email}</span>
                        </a>
                    )}
                </div>
            </div>
            {lightbox && !photoFailed && (
                <PhotoLightbox src={photoSrc} alt={`Foto de ${name}`} onClose={() => setLightbox(false)} />
            )}
        </div>
    );
}
