"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Ambulance, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function TrocarSenhaPage() {
    const router = useRouter();
    const { data: session, status } = useSession();
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState("");

    const minLen = newPassword.length >= 8;
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasDigit = /\d/.test(newPassword);
    const matches = newPassword === confirmPassword && confirmPassword.length > 0;
    const valid = currentPassword.length > 0 && minLen && hasUpper && hasDigit && matches;

    useEffect(() => {
        if (status === "unauthenticated") {
            router.replace("/taximetro/login");
        }
    }, [router, status]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!valid) return;

        setError("");
        setLoading(true);

        try {
            const res = await fetch("/taximetro/api/auth/change-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            const json = await res.json();
            if (!json.success) {
                setError(json.error ?? "Não foi possível alterar a senha.");
                return;
            }

            setSuccess(true);
            setTimeout(() => {
                void signOut({ callbackUrl: "/taximetro/login?passwordChanged=1" });
            }, 1200);
        } catch {
            setError("Erro de conexão. Tente novamente.");
        } finally {
            setLoading(false);
        }
    }

    if (status === "loading") {
        return <div className="flex min-h-screen items-center justify-center bg-background"><p className="text-sm text-slate-500">Carregando...</p></div>;
    }

    if (status === "unauthenticated") return null;

    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
            <div className="w-full max-w-sm">
                <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
                    <div className="mb-6 flex flex-col items-center">
                        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-50">
                            <Ambulance className="h-6 w-6 text-accent-600" strokeWidth={1.5} />
                        </div>
                        <h1 className="text-xl font-semibold text-slate-900">Trocar senha</h1>
                        <p className="mt-1 text-center text-sm text-slate-500">
                            {session?.user?.mustChangePassword
                                ? "Seu acesso foi resetado. Antes de continuar, defina uma nova senha pessoal."
                                : "Atualize sua senha para continuar usando o sistema."}
                        </p>
                    </div>

                    {success ? (
                        <div className="space-y-3 text-center">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-green-50">
                                <CheckCircle className="h-6 w-6 text-green-600" strokeWidth={1.5} />
                            </div>
                            <p className="text-sm font-medium text-slate-700">Senha alterada com sucesso.</p>
                            <p className="text-xs text-slate-400">Você será redirecionado para entrar novamente.</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
                                Se a coordenação resetou seu acesso, a senha temporária atual é 123456.
                            </div>

                            <div>
                                <label htmlFor="currentPassword" className="mb-1 block text-sm font-medium text-slate-700">
                                    Senha atual
                                </label>
                                <Input
                                    id="currentPassword"
                                    type="password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    autoComplete="current-password"
                                    required
                                />
                            </div>

                            <div>
                                <label htmlFor="newPassword" className="mb-1 block text-sm font-medium text-slate-700">
                                    Nova senha
                                </label>
                                <Input
                                    id="newPassword"
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    autoComplete="new-password"
                                    placeholder="Mín. 8 caracteres"
                                    required
                                />
                                <div className="mt-2 space-y-1">
                                    <p className={`text-xs ${minLen ? "text-green-600" : "text-slate-400"}`}>{minLen ? "✓" : "○"} Mínimo 8 caracteres</p>
                                    <p className={`text-xs ${hasUpper ? "text-green-600" : "text-slate-400"}`}>{hasUpper ? "✓" : "○"} Uma letra maiúscula</p>
                                    <p className={`text-xs ${hasDigit ? "text-green-600" : "text-slate-400"}`}>{hasDigit ? "✓" : "○"} Um número</p>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-slate-700">
                                    Confirmar nova senha
                                </label>
                                <Input
                                    id="confirmPassword"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    autoComplete="new-password"
                                    required
                                />
                                {confirmPassword && !matches && <p className="mt-1 text-xs text-red-500">Senhas não conferem.</p>}
                            </div>

                            {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

                            <Button type="submit" className="w-full" disabled={loading || !valid}>
                                {loading ? "Salvando..." : "Salvar nova senha"}
                            </Button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}