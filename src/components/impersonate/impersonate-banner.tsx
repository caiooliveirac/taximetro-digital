"use client";

import { useImpersonate } from "./impersonate-provider";
import { Eye, X } from "lucide-react";

const ROLE_LABEL: Record<string, string> = {
    LEADER: "Líder",
    PRECEPTOR: "Preceptor",
    INTERN: "Interno(a)",
};

export function ImpersonateBanner() {
    const { target, deactivate } = useImpersonate();
    if (!target) return null;

    return (
        <div className="sticky top-0 z-50 bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm min-w-0">
                <Eye className="h-4 w-4 text-amber-600 shrink-0" strokeWidth={1.5} />
                <span className="text-amber-800 truncate">
                    Visualizando como: <strong>{target.name}</strong>
                    <span className="text-amber-600 ml-1">
                        ({ROLE_LABEL[target.role] ?? target.role}
                        {target.facultyName && ` · ${target.facultyName}`})
                    </span>
                </span>
            </div>
            <button
                onClick={deactivate}
                className="flex items-center gap-1 shrink-0 ml-2 text-sm text-amber-700 hover:text-amber-900 font-medium transition-colors"
            >
                <span className="hidden sm:inline">Voltar ao admin</span>
                <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
        </div>
    );
}
