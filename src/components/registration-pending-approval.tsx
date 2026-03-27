import { CheckCircle2, Clock3, ShieldCheck, Sparkles } from "lucide-react";

export function RegistrationPendingApproval({
    title,
    approverLabel,
    loginHint,
}: {
    title: string;
    approverLabel: string;
    loginHint: string;
}) {
    return (
        <div className="relative overflow-hidden rounded-[2rem] border border-emerald-200/80 bg-[linear-gradient(160deg,#f4fff7_0%,#ecfff3_42%,#fffdf5_100%)] p-8 shadow-[0_24px_80px_rgba(17,94,89,0.12)]">
            <div className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-emerald-200/40 blur-3xl" />
            <div className="absolute -left-12 bottom-0 h-40 w-40 rounded-full bg-amber-200/40 blur-3xl" />

            <div className="relative space-y-6 text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1.75rem] border border-emerald-200 bg-white/90 shadow-[0_10px_30px_rgba(16,185,129,0.15)]">
                    <CheckCircle2 className="h-10 w-10 text-emerald-600" strokeWidth={1.75} />
                </div>

                <div className="space-y-3">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700">
                        <Sparkles className="h-3.5 w-3.5" strokeWidth={1.8} />
                        Cadastro Recebido
                    </div>
                    <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
                    <p className="mx-auto max-w-md text-sm leading-6 text-slate-600">
                        Seus dados foram enviados com sucesso. Agora voce so precisa aguardar a aprovacao dos {approverLabel}.
                    </p>
                </div>

                <div className="grid gap-3 text-left sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                            <CheckCircle2 className="h-4 w-4" strokeWidth={1.8} />
                        </div>
                        <p className="text-sm font-semibold text-slate-900">1. Cadastro enviado</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">Seu usuario e sua senha ja foram criados.</p>
                    </div>

                    <div className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                            <Clock3 className="h-4 w-4" strokeWidth={1.8} />
                        </div>
                        <p className="text-sm font-semibold text-slate-900">2. Aguarde liberacao</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">O acesso fica bloqueado ate a aprovacao ser concluida.</p>
                    </div>

                    <div className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
                        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                            <ShieldCheck className="h-4 w-4" strokeWidth={1.8} />
                        </div>
                        <p className="text-sm font-semibold text-slate-900">3. Entre depois</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">Assim que aprovado, voce podera usar o login normalmente.</p>
                    </div>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-5 py-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                    <p className="text-sm font-semibold text-amber-950">Nao tente se cadastrar de novo agora.</p>
                    <p className="mt-1 text-sm leading-6 text-amber-900/80">{loginHint}</p>
                </div>

                <a
                    href="/taximetro/login"
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-slate-950 px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:bg-slate-900"
                >
                    Voltar para o login
                </a>
            </div>
        </div>
    );
}