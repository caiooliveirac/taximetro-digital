"use client";

import { useState, useEffect } from "react";
import { Link2, X, Copy, Check, Loader2 } from "lucide-react";

type Faculty = { id: string; abbreviation: string };

const ROLES = [
    { value: "INTERN", label: "Interno" },
    { value: "LEADER", label: "Líder de Escala" },
    { value: "PRECEPTOR", label: "Preceptor" },
    { value: "COORDINATOR", label: "Coordenador" },
] as const;

export function InviteButton() {
    const [open, setOpen] = useState(false);
    const [role, setRole] = useState("INTERN");
    const [facultyId, setFacultyId] = useState("");
    const [faculties, setFaculties] = useState<Faculty[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [generatedUrl, setGeneratedUrl] = useState("");
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!open) return;
        fetch("/taximetro/api/admin/faculties").then((r) => r.json()).then((fRes) => {
            if (fRes.success) setFaculties(fRes.data);
        });
    }, [open]);

    function reset() {
        setRole("INTERN");
        setFacultyId("");
        setError("");
        setGeneratedUrl("");
        setCopied(false);
    }

    function handleOpen() {
        reset();
        setOpen(true);
    }

    const needsFaculty = role === "INTERN" || role === "LEADER";
    const canSubmit = needsFaculty ? !!facultyId : true;

    async function generate() {
        setError("");
        setLoading(true);
        try {
            const body: Record<string, string> = { targetRole: role };
            if (needsFaculty) body.facultyId = facultyId;

            const res = await fetch("/taximetro/api/admin/invites", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const json = await res.json();
            if (!json.success) {
                setError(json.error ?? "Erro ao gerar link");
            } else {
                setGeneratedUrl(json.data.url);
            }
        } catch {
            setError("Erro de conexão.");
        } finally {
            setLoading(false);
        }
    }

    async function copyLink() {
        try {
            await navigator.clipboard.writeText(generatedUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback: select the text
            const input = document.querySelector<HTMLInputElement>("#invite-url-input");
            if (input) { input.select(); document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2000); }
        }
    }

    const roleName = ROLES.find((r) => r.value === role)?.label ?? role;
    const facultyName = faculties.find((f) => f.id === facultyId)?.abbreviation;

    return (
        <>
            <button
                onClick={handleOpen}
                className="flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 text-sm font-semibold text-white shadow-md hover:bg-orange-600 active:bg-orange-700 transition-colors"
            >
                <Link2 className="h-5 w-5" />
                Gerar Convite
            </button>

            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setOpen(false)}>
                    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-lg font-semibold text-slate-900">Gerar Link de Convite</h2>
                            <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {!generatedUrl ? (
                            <div className="space-y-4">
                                {/* Role selection */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                        Papel do convidado
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {ROLES.map((r) => (
                                            <button
                                                key={r.value}
                                                type="button"
                                                onClick={() => { setRole(r.value); setFacultyId(""); }}
                                                className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${role === r.value
                                                    ? "border-orange-500 bg-orange-50 text-orange-700"
                                                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                                                    }`}
                                            >
                                                {r.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Faculty selector for INTERN / LEADER */}
                                {needsFaculty && (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                            Faculdade
                                        </label>
                                        <select
                                            value={facultyId}
                                            onChange={(e) => setFacultyId(e.target.value)}
                                            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-400/20"
                                        >
                                            <option value="">Selecione a faculdade...</option>
                                            {faculties.map((f) => (
                                                <option key={f.id} value={f.id}>{f.abbreviation}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {/* Summary */}
                                <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                                    <span className="font-medium">Resumo:</span> Convite para{" "}
                                    <span className="font-semibold text-slate-900">{roleName}</span>
                                    {needsFaculty && facultyName && (
                                        <> — Faculdade <span className="font-semibold text-slate-900">{facultyName}</span></>
                                    )}
                                    <br />
                                    <span className="text-xs text-slate-400">Válido por 7 dias</span>
                                </div>

                                {error && (
                                    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-600/10">
                                        {error}
                                    </p>
                                )}

                                <button
                                    onClick={generate}
                                    disabled={!canSubmit || loading}
                                    className="w-full rounded-lg bg-orange-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                                    {loading ? "Gerando..." : "Gerar Link"}
                                </button>
                            </div>
                        ) : (
                            /* Success: show the generated link */
                            <div className="space-y-4">
                                <div className="rounded-lg bg-green-50 p-4 text-center">
                                    <p className="text-sm font-medium text-green-800 mb-1">Link gerado com sucesso!</p>
                                    <p className="text-xs text-green-600">
                                        {roleName}
                                        {facultyName ? ` — ${facultyName}` : ""}
                                    </p>
                                </div>

                                <div className="flex gap-2">
                                    <input
                                        id="invite-url-input"
                                        readOnly
                                        value={generatedUrl}
                                        className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700 font-mono truncate"
                                    />
                                    <button
                                        onClick={copyLink}
                                        className={`flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${copied
                                            ? "bg-green-500 text-white"
                                            : "bg-orange-500 text-white hover:bg-orange-600"
                                            }`}
                                    >
                                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                        {copied ? "Copiado!" : "Copiar"}
                                    </button>
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => { setGeneratedUrl(""); setError(""); }}
                                        className="flex-1 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                                    >
                                        Gerar outro
                                    </button>
                                    <button
                                        onClick={() => setOpen(false)}
                                        className="flex-1 rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors"
                                    >
                                        Fechar
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
