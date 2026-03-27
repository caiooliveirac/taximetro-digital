"use client";

import { useEffect } from "react";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error("[GlobalError]", error);
    }, [error]);

    const isDbError =
        error.message?.includes("ECONNREFUSED") ||
        error.message?.includes("connect") ||
        error.message?.includes("timeout");

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
