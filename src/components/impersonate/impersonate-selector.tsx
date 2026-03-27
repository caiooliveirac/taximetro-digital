"use client";

import { useState, useEffect, useMemo } from "react";
import { useImpersonate, type ImpersonateTarget } from "./impersonate-provider";
import {
    X,
    Search,
    Users,
    Stethoscope,
    GraduationCap,
    ChevronRight,
    type LucideIcon,
} from "lucide-react";

interface User {
    id: string;
    name: string;
    role: string;
    facultyId: string | null;
    facultyAbbr: string | null;
    baseId: string | null;
    baseCode: string | null;
    isActive: boolean;
}

type TargetRole = "LEADER" | "PRECEPTOR" | "INTERN";

interface Props {
    role: TargetRole;
    open: boolean;
    onClose: () => void;
}

const ROLE_CFG: Record<TargetRole, { label: string; icon: LucideIcon }> = {
    LEADER: { label: "Líder", icon: Users },
    PRECEPTOR: { label: "Preceptor", icon: Stethoscope },
    INTERN: { label: "Interno", icon: GraduationCap },
};

export function ImpersonateSelector({ role, open, onClose }: Props) {
    const { activate } = useImpersonate();
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [selectedFaculty, setSelectedFaculty] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setSearch("");
        setSelectedFaculty(null);
        setLoading(true);
        fetch(`/taximetro/api/admin/users?impersonateRole=${role}`, {
            headers: { "x-no-impersonate": "1" },
        })
            .then((r) => r.json())
            .then((j) => {
                if (j.success) setAllUsers(j.data);
            })
            .finally(() => setLoading(false));
    }, [open]);

    const roleUsers = useMemo(() => allUsers.filter((u) => u.isActive), [allUsers]);

    const faculties = useMemo(() => {
        const map = new Map<string, { id: string; abbr: string; count: number }>();
        for (const u of roleUsers) {
            if (!u.facultyId) continue;
            const cur = map.get(u.facultyId);
            if (cur) {
                cur.count++;
            } else {
                map.set(u.facultyId, { id: u.facultyId, abbr: u.facultyAbbr ?? "?", count: 1 });
            }
        }
        return Array.from(map.values()).sort((a, b) => a.abbr.localeCompare(b.abbr));
    }, [roleUsers]);

    const filtered = useMemo(() => {
        let list = roleUsers;
        if (selectedFaculty) list = list.filter((u) => u.facultyId === selectedFaculty);
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter((u) => u.name.toLowerCase().includes(q));
        }
        return list.sort((a, b) => a.name.localeCompare(b.name));
    }, [roleUsers, selectedFaculty, search]);

    function handleSelect(user: User) {
        const fac = faculties.find((f) => f.id === user.facultyId);
        const t: ImpersonateTarget = {
            userId: user.id,
            role,
            name: user.name,
            facultyId: user.facultyId,
            facultyName: fac?.abbr ?? null,
            baseId: user.baseId,
        };
        activate(t);
        onClose();
    }

    if (!open) return null;

    const cfg = ROLE_CFG[role];

    return (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
                onClick={onClose}
            />
            <div className="relative w-full max-w-md mx-0 sm:mx-4 rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[85vh] flex flex-col animate-in slide-in-from-bottom duration-200">
                {/* Header */}
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4 rounded-t-2xl">
                    <div className="flex items-center gap-2">
                        <cfg.icon className="h-5 w-5 text-accent-500" strokeWidth={1.5} />
                        <span className="font-semibold text-slate-900">
                            Visualizar como {cfg.label}
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition-colors"
                    >
                        <X className="h-5 w-5" strokeWidth={1.5} />
                    </button>
                </div>

                {/* Search + faculty chips */}
                <div className="px-4 pt-3 pb-2">
                    <div className="relative">
                        <Search
                            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
                            strokeWidth={1.5}
                        />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar por nome..."
                            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent-500/30"
                        />
                    </div>
                    {(role === "LEADER" || role === "INTERN") && faculties.length > 1 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            <button
                                onClick={() => setSelectedFaculty(null)}
                                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${!selectedFaculty
                                        ? "bg-accent-100 text-accent-700"
                                        : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                    }`}
                            >
                                Todas
                            </button>
                            {faculties.map((f) => (
                                <button
                                    key={f.id}
                                    onClick={() =>
                                        setSelectedFaculty(f.id === selectedFaculty ? null : f.id)
                                    }
                                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${selectedFaculty === f.id
                                            ? "bg-accent-100 text-accent-700"
                                            : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                        }`}
                                >
                                    {f.abbr} ({f.count})
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* User list */}
                <div className="flex-1 overflow-y-auto px-2 pb-4">
                    {loading ? (
                        <div className="py-12 text-center text-sm text-slate-400">
                            Carregando...
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="py-12 text-center text-sm text-slate-400">
                            Nenhum usuário encontrado
                        </div>
                    ) : (
                        filtered.map((u) => {
                            const initials = u.name
                                .split(" ")
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((w) => w[0])
                                .join("")
                                .toUpperCase();
                            return (
                                <button
                                    key={u.id}
                                    onClick={() => handleSelect(u)}
                                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-slate-50 transition-colors"
                                >
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-accent-400">
                                        {initials || "?"}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-medium text-slate-900">
                                            {u.name}
                                        </p>
                                        <p className="text-xs text-slate-400">
                                            {u.facultyAbbr ?? ""}
                                            {u.baseCode ? ` · ${u.baseCode}` : ""}
                                        </p>
                                    </div>
                                    <ChevronRight
                                        className="h-4 w-4 text-slate-300 shrink-0"
                                        strokeWidth={1.5}
                                    />
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
