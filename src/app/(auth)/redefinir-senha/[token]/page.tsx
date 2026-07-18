"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Ambulance, CheckCircle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ORG_NAME } from "@/lib/branding";

export default function RedefinirSenhaPage() {
    const { token } = useParams<{ token: string }>();
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const minLen = password.length >= 8;
    const hasUpper = /[A-Z]/.test(password);
    const hasDigit = /\d/.test(password);
    const match = password === confirm && confirm.length > 0;
    const valid = minLen && hasUpper && hasDigit && match;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!valid) return;
        setError("");
        setLoading(true);
        try {
            const res = await fetch("/taximetro/api/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, password }),
            });
            const json = await res.json();
            if (!json.success) {
                setError(json.error ?? "Erro ao redefinir senha.");
            } else {
                setSuccess(true);
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
                        <h1 className="text-xl font-semibold text-slate-900">Redefinir Senha</h1>
                        <p className="mt-1 text-sm text-slate-500">{ORG_NAME}</p>
                    </div>

                    {success ? (
                        <div className="text-center space-y-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 mx-auto">
                                <CheckCircle className="h-6 w-6 text-green-600" strokeWidth={1.5} />
                            </div>
                            <p className="text-sm text-slate-700 font-medium">Senha redefinida com sucesso!</p>
                            <p className="text-xs text-slate-400">Faça login com sua nova senha.</p>
                            <a href="/taximetro/login" className="mt-4 inline-block text-sm font-medium text-accent-600 hover:text-accent-500">
                                Ir para Login
                            </a>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
                                    Nova senha
                                </label>
                                <div className="relative">
                                    <Input
                                        id="password"
                                        type={showPw ? "text" : "password"}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Mín. 8 caracteres"
                                        required
                                        className="pr-10"
                                    />
                                    <button type="button" tabIndex={-1} onClick={() => setShowPw(!showPw)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                                <div className="mt-2 space-y-1">
                                    <p className={`text-xs ${minLen ? "text-green-600" : "text-slate-400"}`}>
                                        {minLen ? "✓" : "○"} Mínimo 8 caracteres
                                    </p>
                                    <p className={`text-xs ${hasUpper ? "text-green-600" : "text-slate-400"}`}>
                                        {hasUpper ? "✓" : "○"} Uma letra maiúscula
                                    </p>
                                    <p className={`text-xs ${hasDigit ? "text-green-600" : "text-slate-400"}`}>
                                        {hasDigit ? "✓" : "○"} Um número
                                    </p>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="confirm" className="block text-sm font-medium text-slate-700 mb-1">
                                    Confirmar nova senha
                                </label>
                                <Input
                                    id="confirm"
                                    type={showPw ? "text" : "password"}
                                    value={confirm}
                                    onChange={(e) => setConfirm(e.target.value)}
                                    placeholder="Repita a senha"
                                    required
                                />
                                {confirm && !match && (
                                    <p className="mt-1 text-xs text-red-500">Senhas não conferem.</p>
                                )}
                            </div>

                            {error && (
                                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
                            )}

                            <Button type="submit" className="w-full" disabled={loading || !valid}>
                                {loading ? "Redefinindo..." : "Redefinir Senha"}
                            </Button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
