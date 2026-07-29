"use client";
import { ORG_NAME } from "@/lib/branding";

import { useState } from "react";
import { Ambulance, ArrowLeft, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function EsqueciSenhaPage() {
    const [email, setEmail] = useState("");
    const [sent, setSent] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const res = await fetch("/taximetro/api/auth/forgot-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            const json = await res.json();
            if (!json.success) {
                setError(json.error ?? "Erro ao enviar. Tente novamente.");
            } else {
                setSent(true);
            }
        } catch {
            setError("Erro de conexão. Tente novamente.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
            <div className="w-full max-w-sm">
                <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
                    <div className="flex flex-col items-center mb-6">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-50 mb-3">
                            <Ambulance className="h-6 w-6 text-accent-600" strokeWidth={1.5} />
                        </div>
                        <h1 className="text-xl font-semibold text-slate-900">Recuperar Senha</h1>
                        <p className="mt-1 text-sm text-slate-500">{ORG_NAME}</p>
                    </div>

                    {sent ? (
                        <div className="text-center space-y-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 mx-auto">
                                <Mail className="h-6 w-6 text-green-600" strokeWidth={1.5} />
                            </div>
                            <p className="text-sm text-slate-700">
                                Se o e-mail estiver cadastrado, você receberá um link para redefinir sua senha.
                            </p>
                            <p className="text-xs text-slate-400">Verifique também a pasta de spam.</p>
                            <a href="/taximetro/login" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent-600 hover:text-accent-500">
                                <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} /> Voltar ao login
                            </a>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                                    E-mail cadastrado
                                </label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="joao@email.com"
                                    required
                                    autoComplete="email"
                                />
                            </div>

                            {error && (
                                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
                            )}

                            <Button type="submit" className="w-full" disabled={loading}>
                                {loading ? "Enviando..." : "Enviar link de redefinição"}
                            </Button>

                            <div className="text-center">
                                <a href="/taximetro/login" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
                                    <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} /> Voltar ao login
                                </a>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
