"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export interface ImpersonateTarget {
    userId: string;
    role: "LEADER" | "PRECEPTOR" | "INTERN";
    name: string;
    facultyId: string | null;
    facultyName: string | null;
    baseId: string | null;
}

interface ImpersonateCtx {
    target: ImpersonateTarget | null;
    activate: (t: ImpersonateTarget) => void;
    deactivate: () => void;
}

const Ctx = createContext<ImpersonateCtx>({
    target: null,
    activate: () => { },
    deactivate: () => { },
});

export function useImpersonate() {
    return useContext(Ctx);
}

const STORAGE_KEY = "taximetro_impersonate";
const COOKIE_NAME = "x-impersonate-user";
const COOKIE_ROLE_NAME = "x-impersonate-role";
const COOKIE_PATH = "/taximetro";

function setCookie(target: ImpersonateTarget) {
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(target.userId)}; path=${COOKIE_PATH}; SameSite=Lax`;
    document.cookie = `${COOKIE_ROLE_NAME}=${encodeURIComponent(target.role)}; path=${COOKIE_PATH}; SameSite=Lax`;
}

function clearCookie() {
    document.cookie = `${COOKIE_NAME}=; path=${COOKIE_PATH}; max-age=0`;
    document.cookie = `${COOKIE_ROLE_NAME}=; path=${COOKIE_PATH}; max-age=0`;
}

const ROLE_PREFIX: Record<string, string> = {
    LEADER: "/leader",
    PRECEPTOR: "/preceptor",
    INTERN: "/intern",
};

export function ImpersonateProvider({ children }: { children: ReactNode }) {
    const [target, setTarget] = useState<ImpersonateTarget | null>(null);
    const router = useRouter();

    // Hydrate from sessionStorage on mount
    useEffect(() => {
        try {
            const stored = sessionStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as ImpersonateTarget;
                if (parsed.userId) {
                    setTarget(parsed);
                    setCookie(parsed);
                }
            } else {
                clearCookie();
            }
        } catch {
            /* ignore */
        }
    }, []);

    const activate = useCallback(
        (t: ImpersonateTarget) => {
            setTarget(t);
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(t));
            setCookie(t);
            router.push(ROLE_PREFIX[t.role] ?? "/admin");
        },
        [router],
    );

    const deactivate = useCallback(() => {
        setTarget(null);
        sessionStorage.removeItem(STORAGE_KEY);
        clearCookie();
        router.push("/admin");
    }, [router]);

    return <Ctx.Provider value={{ target, activate, deactivate }}>{children}</Ctx.Provider>;
}
