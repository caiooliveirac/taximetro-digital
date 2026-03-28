"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type PreceptorBase = { id: string; code: string; name: string; type: string };
export type PreceptorShift = "DAY" | "NIGHT";

type PreceptorCtx = {
  base: PreceptorBase | null;
  shift: PreceptorShift | null;
  bases: PreceptorBase[];
  loading: boolean;
  declare: (base: PreceptorBase, shift: PreceptorShift) => void;
  clear: () => void;
};

const PreceptorContext = createContext<PreceptorCtx>({
  base: null,
  shift: null,
  bases: [],
  loading: true,
  declare: () => { },
  clear: () => { },
});

export function usePreceptor() {
  return useContext(PreceptorContext);
}

const STORAGE_KEY = "preceptor_declaration";

export function PreceptorProvider({ children }: { children: ReactNode }) {
  const [base, setBase] = useState<PreceptorBase | null>(null);
  const [shift, setShift] = useState<PreceptorShift | null>(null);
  const [bases, setBases] = useState<PreceptorBase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load bases from API
    fetch("/taximetro/api/preceptor/bases", { headers: { "x-force-role": "PRECEPTOR" } })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setBases(json.data);
      })
      .finally(() => setLoading(false));

    // Restore from sessionStorage
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.base && parsed.shift) {
          setBase(parsed.base);
          setShift(parsed.shift);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  function declare(b: PreceptorBase, s: PreceptorShift) {
    setBase(b);
    setShift(s);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ base: b, shift: s, at: new Date().toISOString() }));
  }

  function clear() {
    setBase(null);
    setShift(null);
    sessionStorage.removeItem(STORAGE_KEY);
  }

  return (
    <PreceptorContext.Provider value={{ base, shift, bases, loading, declare, clear }}>
      {children}
    </PreceptorContext.Provider>
  );
}
