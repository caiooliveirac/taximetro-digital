"use client";

import { useEffect } from "react";

const STALE_BUNDLE_RELOAD_KEY = "__taximetro_stale_reload_at";
const STALE_BUNDLE_RELOAD_COOLDOWN_MS = 60_000;

function isStaleBundleError(error: Error & { digest?: string }) {
    const name = error?.name ?? "";
    const message = error?.message ?? "";
    return (
        name === "ChunkLoadError" ||
        /Loading chunk [\w-]+ failed/i.test(message) ||
        /Loading CSS chunk/i.test(message) ||
        /Failed to fetch dynamically imported module/i.test(message) ||
        /router state header/i.test(message) ||
        /Unexpected Server Response/i.test(message)
    );
}

function tryHardReloadOnce() {
    if (typeof window === "undefined") return false;
    try {
        const last = Number(sessionStorage.getItem(STALE_BUNDLE_RELOAD_KEY) ?? "0");
        if (Date.now() - last < STALE_BUNDLE_RELOAD_COOLDOWN_MS) return false;
        sessionStorage.setItem(STALE_BUNDLE_RELOAD_KEY, String(Date.now()));
    } catch {
        // sessionStorage indisponível — segue o reload mesmo assim
    }
    window.location.reload();
    return true;
}

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const staleBundle = isStaleBundleError(error);

    useEffect(() => {
        console.error("[GlobalError]", error);
        if (staleBundle) tryHardReloadOnce();
    }, [error, staleBundle]);

    const isDbError =
        !staleBundle &&
        (error.message?.includes("ECONNREFUSED") ||
            error.message?.includes("connect") ||
            error.message?.includes("timeout"));

    return (
        <div className="flex min-h-[60vh] items-center justify-center p-8">
            <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center">
                <h2 className="mb-2 text-lg font-semibold text-red-800">
                    {isDbError ? "Serviço temporariamente indisponível" : "Algo deu errado"}
                </h2>
                <p className="mb-4 text-sm text-red-600">
                    {isDbError
                        ? "Não foi possível conectar ao banco de dados. Tente novamente em alguns segundos."
                        : "Ocorreu um erro inesperado. Tente recarregar a página."}
                </p>
                <div className="flex justify-center gap-3">
                    <button
                        onClick={reset}
                        className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                    >
                        Tentar novamente
                    </button>
                    <a
                        href="/taximetro/login"
                        className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Ir para login
                    </a>
                </div>
            </div>
        </div>
    );
}
