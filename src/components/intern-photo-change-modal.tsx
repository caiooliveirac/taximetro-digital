"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, ImagePlus, Loader2, RefreshCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { compressImage } from "@/lib/compress-image";

type PendingRequest = {
  id: string;
  requestedSelfie: string;
  requestedAt: string;
  status: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

export function InternPhotoChangeModal({ open, onClose }: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [currentSelfie, setCurrentSelfie] = useState<string | null>(null);
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null);
  const [selectedSelfie, setSelectedSelfie] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadState = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/taximetro/api/intern/photo-change");
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Erro ao carregar foto atual.");
        return;
      }
      setCurrentSelfie(json.data.currentSelfie ?? null);
      setPendingRequest(json.data.pendingRequest ?? null);
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedSelfie(null);
    setSuccess("");
    void loadState();
  }, [open, loadState]);

  const handleSelfieChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const compressed = await compressImage(file);
      setSelectedSelfie(compressed);
    } catch {
      setError("Erro ao processar foto. Tente novamente.");
    }
  }, []);

  async function handleSubmit() {
    if (!selectedSelfie) {
      setError("Escolha uma nova foto antes de enviar.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/taximetro/api/intern/photo-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selfie: selectedSelfie }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Erro ao enviar solicitação.");
        return;
      }
      setPendingRequest(json.data.pendingRequest ?? null);
      setCurrentSelfie(json.data.currentSelfie ?? null);
      setSelectedSelfie(null);
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      setSuccess("Solicitação enviada. Agora aguarde a validação da líder.");
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const previewSelfie = selectedSelfie ?? pendingRequest?.requestedSelfie ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Trocar foto</h2>
            <p className="mt-1 text-sm text-slate-500">A nova foto só entra no sistema depois da validação da líder.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : (
            <>
              {pendingRequest && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <p className="font-medium text-amber-900">Existe uma troca aguardando validação</p>
                  <p className="mt-1">Enviada em {formatDateTime(pendingRequest.requestedAt)}. Se quiser, você pode substituir essa foto pendente.</p>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Foto atual</p>
                  {currentSelfie ? (
                    <img src={currentSelfie} alt="Foto atual" className="mx-auto h-28 w-28 rounded-full object-cover ring-2 ring-slate-200" />
                  ) : (
                    <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full border border-dashed border-slate-300 text-xs text-slate-400">
                      Sem foto
                    </div>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Nova foto</p>
                  {previewSelfie ? (
                    <img src={previewSelfie} alt="Nova foto" className="mx-auto h-28 w-28 rounded-full object-cover ring-2 ring-accent-200" />
                  ) : (
                    <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full border border-dashed border-slate-300 text-xs text-slate-400">
                      Escolha uma foto
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-center gap-3">
                <input ref={cameraInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handleSelfieChange} />
                <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={handleSelfieChange} />
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => cameraInputRef.current?.click()} className="gap-2">
                    <Camera className="h-4 w-4" /> Câmera
                  </Button>
                  <Button type="button" variant="outline" onClick={() => galleryInputRef.current?.click()} className="gap-2">
                    <ImagePlus className="h-4 w-4" /> Galeria
                  </Button>
                </div>
                {selectedSelfie && (
                  <button type="button" onClick={() => setSelectedSelfie(null)} className="text-xs font-medium text-slate-500 hover:text-slate-700">
                    Remover prévia selecionada
                  </button>
                )}
              </div>

              {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
              {success && <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

              <div className="flex justify-between gap-2">
                <Button type="button" variant="outline" onClick={() => void loadState()} disabled={loading || saving} className="gap-2">
                  <RefreshCcw className="h-4 w-4" /> Atualizar
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Fechar</Button>
                  <Button type="button" onClick={handleSubmit} disabled={saving || !selectedSelfie}>
                    {saving ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</span> : pendingRequest ? "Substituir foto pendente" : "Enviar para validação"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}