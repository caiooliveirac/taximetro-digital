"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Ambulance, CheckCircle, Camera, ImagePlus, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function compressImage(file: File, maxSize = 400): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width, h = img.height;
        if (w > h) { if (w > maxSize) { h = (h * maxSize) / w; w = maxSize; } }
        else { if (h > maxSize) { w = (w * maxSize) / h; h = maxSize; } }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const ROLES = [
  { value: "INTERN", label: "Interno" },
  { value: "LEADER", label: "Líder de Escala" },
  { value: "PRECEPTOR", label: "Preceptor" },
  { value: "COORDINATOR", label: "Coordenador" },
] as const;

type Faculty = { id: string; abbreviation: string; name: string };
type Base = { id: string; code: string; name: string };

export default function RegistroGooglePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-background"><p className="text-slate-500">Carregando...</p></div>}>
      <RegistroGoogleForm />
    </Suspense>
  );
}

function RegistroGoogleForm() {
  const searchParams = useSearchParams();
  const prefillEmail = searchParams.get("email") ?? "";
  const prefillName = searchParams.get("name") ?? "";

  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState(prefillName);
  const [email] = useState(prefillEmail);
  const [cpf, setCpf] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("INTERN");
  const [facultyId, setFacultyId] = useState("");
  const [baseId, setBaseId] = useState("");
  const [selfie, setSelfie] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [bases, setBases] = useState<Base[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/taximetro/api/admin/faculties").then((r) => r.json()).catch(() => ({ success: false })),
      fetch("/taximetro/api/admin/bases").then((r) => r.json()).catch(() => ({ success: false })),
    ]).then(([fRes, bRes]) => {
      if (fRes.success) setFaculties(fRes.data);
      if (bRes.success) setBases(bRes.data);
    });
  }, []);

  function formatCpf(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }

  function formatPhone(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  const handleSelfieChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setSelfie(compressed);
    } catch {
      setError("Erro ao processar foto. Tente novamente.");
    }
  }, []);

  const needsFaculty = role === "INTERN" || role === "LEADER";
  const needsBase = role === "PRECEPTOR";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!selfie) { setError("Selfie obrigatória para identificação."); return; }
    if (needsFaculty && !facultyId) { setError("Selecione uma faculdade."); return; }
    if (needsBase && !baseId) { setError("Selecione uma base."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/taximetro/api/registro/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          cpf: cpf || undefined,
          phone,
          role,
          facultyId: needsFaculty ? facultyId : undefined,
          baseId: needsBase ? baseId : undefined,
          selfie,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? "Erro ao registrar");
      } else {
        setSuccess(true);
      }
    } catch {
      setError("Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!prefillEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)] text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 mx-auto mb-3">
            <AlertCircle className="h-6 w-6 text-red-500" strokeWidth={1.5} />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Acesso inválido</h1>
          <p className="mt-2 text-sm text-slate-500">
            Use o botão &ldquo;Continuar com Google&rdquo; na tela de login para iniciar o cadastro.
          </p>
          <a href="/taximetro/login" className="mt-4 inline-block text-sm font-medium text-accent-600 hover:text-accent-500">
            Ir para Login
          </a>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)] text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 mx-auto mb-3">
            <CheckCircle className="h-6 w-6 text-green-600" strokeWidth={1.5} />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Cadastro enviado!</h1>
          <p className="mt-2 text-sm text-slate-500">
            Seu cadastro foi recebido e está aguardando aprovação do coordenador.
            Após aprovado, basta fazer login com Google.
          </p>
          <a href="/taximetro/login" className="mt-4 inline-block text-sm font-medium text-accent-600 hover:text-accent-700 transition-colors">
            ← Voltar ao login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex flex-col items-center mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-50 mb-3">
              <Ambulance className="h-6 w-6 text-accent-600" strokeWidth={1.5} />
            </div>
            <h1 className="text-xl font-semibold text-slate-900">Cadastro via Google</h1>
            <p className="mt-1 text-sm text-slate-500">Complete seus dados para solicitar acesso</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Selfie */}
            <div className="flex flex-col items-center">
              <input ref={cameraInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handleSelfieChange} />
              <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={handleSelfieChange} />
              {selfie ? (
                <div className="relative">
                  <img src={selfie} alt="Selfie" className="h-28 w-28 rounded-full object-cover ring-2 ring-accent-200" />
                  <button type="button" onClick={() => { setSelfie(null); if (cameraInputRef.current) cameraInputRef.current.value = ""; if (galleryInputRef.current) galleryInputRef.current.value = ""; }}
                    className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-4">
                  <button type="button" onClick={() => cameraInputRef.current?.click()}
                    className="flex h-28 w-28 flex-col items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-slate-400 hover:border-accent-400 hover:text-accent-500 transition-colors">
                    <Camera className="h-7 w-7 mb-1" />
                    <span className="text-[10px] font-medium">Câmera</span>
                  </button>
                  <button type="button" onClick={() => galleryInputRef.current?.click()}
                    className="flex h-28 w-28 flex-col items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-slate-400 hover:border-accent-400 hover:text-accent-500 transition-colors">
                    <ImagePlus className="h-7 w-7 mb-1" />
                    <span className="text-[10px] font-medium">Galeria</span>
                  </button>
                </div>
              )}
              <p className="mt-1.5 text-xs text-slate-400">Foto para identificação</p>
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">Nome completo</label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="João da Silva" required />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">E-mail Google</label>
              <Input id="email" type="email" value={email} readOnly className="bg-slate-50 text-slate-500" />
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-1">Telefone</label>
              <Input id="phone" inputMode="tel" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="(71) 99999-0000" required />
            </div>

            <div>
              <label htmlFor="cpf" className="block text-sm font-medium text-slate-700 mb-1">
                CPF <span className="text-slate-400">(opcional)</span>
              </label>
              <Input id="cpf" inputMode="numeric" value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} placeholder="000.000.000-00" />
            </div>

            {/* Role selector */}
            <div>
              <label htmlFor="role" className="block text-sm font-medium text-slate-700 mb-1">Sua função</label>
              <select
                id="role"
                value={role}
                onChange={(e) => { setRole(e.target.value); setBaseId(""); }}
                className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            {/* Faculty */}
            {needsFaculty && (
              <div>
                <label htmlFor="faculty" className="block text-sm font-medium text-slate-700 mb-1">Faculdade</label>
                <select
                  id="faculty"
                  value={facultyId}
                  onChange={(e) => setFacultyId(e.target.value)}
                  className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  required
                >
                  <option value="">Selecione...</option>
                  {faculties.map((f) => (
                    <option key={f.id} value={f.id}>{f.abbreviation} — {f.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Base (only for preceptors) */}
            {needsBase && (
              <div>
                <label htmlFor="base" className="block text-sm font-medium text-slate-700 mb-1">Base</label>
                <select
                  id="base"
                  value={baseId}
                  onChange={(e) => setBaseId(e.target.value)}
                  className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  required
                >
                  <option value="">Selecione...</option>
                  {bases.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                  ))}
                </select>
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-600/10">
                {error}
              </p>
            )}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Enviando..." : "Solicitar Acesso"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
