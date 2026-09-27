"use client";

import { useState } from "react";
import { CheckCircle, Frown, Loader2, Meh, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";

export type NpsAnswer = "SAD" | "NEUTRAL" | "HAPPY";

export type CheckoutNps = {
  knowledge: NpsAnswer;
  proactivity: NpsAnswer;
  punctuality: NpsAnswer;
};

type Draft = { [K in keyof CheckoutNps]: NpsAnswer | null };

const EMPTY: Draft = { knowledge: null, proactivity: null, punctuality: null };

const NPS_OPTIONS: Array<{ value: NpsAnswer; label: string; Icon: typeof Frown }> = [
  { value: "SAD", label: "Triste", Icon: Frown },
  { value: "NEUTRAL", label: "Neutra", Icon: Meh },
  { value: "HAPPY", label: "Feliz", Icon: Smile },
];

const QUESTIONS: Array<{ key: keyof CheckoutNps; label: string }> = [
  { key: "knowledge", label: "Conhecimentos apresentados" },
  { key: "proactivity", label: "Proatividade" },
  { key: "punctuality", label: "Pontualidade" },
];

/** As 3 perguntas + observação que o preceptor responde antes de fechar o checkout. */
export function CheckoutNpsForm({
  submitting,
  onCancel,
  onSubmit,
}: {
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (nps: CheckoutNps, notes: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [notes, setNotes] = useState("");
  const complete = draft.knowledge && draft.proactivity && draft.punctuality;

  return (
    <div className="mt-3 rounded-lg border border-blue-200 bg-white p-3">
      <p className="text-xs font-semibold text-slate-700">Antes de confirmar checkout, responda as 3 perguntas:</p>
      <div className="mt-2 space-y-3">
        {QUESTIONS.map(({ key, label }) => (
          <div key={key}>
            <p className="text-xs text-slate-600">{label}</p>
            <div className="mt-1 flex gap-2">
              {NPS_OPTIONS.map(({ value, label: optionLabel, Icon }) => (
                <Button
                  key={`${key}-${value}`}
                  type="button"
                  size="sm"
                  variant={draft[key] === value ? "default" : "outline"}
                  onClick={() => setDraft((prev) => ({ ...prev, [key]: value }))}
                  className="min-w-24"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {optionLabel}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-3">
        <div>
          <p className="text-xs text-slate-600">Observações do preceptor (opcional)</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: conduta, intercorrências, pontos de atenção"
            maxLength={2000}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => { if (complete) onSubmit(draft as CheckoutNps, notes); }}
            disabled={submitting || !complete}
            className="gap-1"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} /> : <CheckCircle className="h-3.5 w-3.5" strokeWidth={1.5} />}
            Confirmar checkout
          </Button>
        </div>
      </div>
    </div>
  );
}
