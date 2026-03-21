"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { Ambulance, CheckCircle, Camera, ImagePlus, UserCircle, Eye, EyeOff, X } from "lucide-react";
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

const PASSWORD_RULES = [
  { test: (v: string) => v.length >= 8, label: "Mínimo 8 caracteres" },
  { test: (v: string) => /[A-Z]/.test(v), label: "Uma letra maiúscula" },
  { test: (v: string) => /[a-z]/.test(v), label: "Uma letra minúscula" },
  { test: (v: string) => /\d/.test(v), label: "Um número" },
];

const ROLE_LABEL: Record<string, string> = {
  COORDINATOR: "Coordenador",
  LEADER: "Líder de Escala",
  PRECEPTOR: "Preceptor",
  INTERN: "Interno",
};

export default function RegistroPage() {
  const { token } = useParams<{ token: string }>();
  const [faculty, setFaculty] = useState<{ targetRole: string; facultyName: string; facultyAbbr: string; baseCode: string | null; baseName: string | null } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [name, setName] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [selfie, setSelfie] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

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

  const passwordValid = PASSWORD_RULES.every((r) => r.test(password));

  useEffect(() => {
    fetch(`/taximetro/api/registro/${token}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setFaculty(json.data);
        else setInvalid(true);
        setLoading(false);
      })
      .catch(() => { setInvalid(true); setLoading(false); });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!passwordValid) { setError("A senha não atende aos requisitos."); return; }
    if (!selfie) { setError("Selfie obrigatória para identificação."); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/taximetro/api/registro/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, cpf: cpf || undefined, email, phone, password, selfie }),
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-slate-500">Carregando...</p>
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)] text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 mx-auto mb-3">
            <Ambulance className="h-6 w-6 text-red-500" strokeWidth={1.5} />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Link inválido</h1>
          <p className="mt-2 text-sm text-slate-500">Este link de registro não existe ou já expirou.</p>
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
          <h1 className="text-xl font-semibold text-slate-900">Registro enviado!</h1>
          <p className="mt-2 text-sm text-slate-500">
            Seu cadastro foi recebido e está aguardando aprovação do líder de escala.
            Você será notificado quando for aprovado.
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
            <h1 className="text-xl font-semibold text-slate-900">Registro — {ROLE_LABEL[faculty?.targetRole ?? "INTERN"] ?? "Interno"}</h1>
            {faculty?.facultyName && (
              <p className="mt-1 text-sm text-slate-500">
                Faculdade: <span className="font-medium text-slate-900">{faculty.facultyName}</span>
              </p>
            )}
            {faculty?.baseName && (
              <p className="mt-1 text-sm text-slate-500">
                Base: <span className="font-medium text-slate-900">{faculty.baseCode} — {faculty.baseName}</span>
              </p>
            )}
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
              <p className="mt-1.5 text-xs text-slate-400">Foto para identificação no check-in</p>
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
                Nome completo
              </label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="João da Silva" required />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                E-mail
              </label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="joao@email.com" required />
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-1">
                Telefone
              </label>
              <Input id="phone" inputMode="tel" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="(71) 99999-0000" required />
            </div>

            <div>
              <label htmlFor="cpf" className="block text-sm font-medium text-slate-700 mb-1">
                CPF <span className="text-slate-400">(opcional)</span>
              </label>
              <Input id="cpf" inputMode="numeric" value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} placeholder="000.000.000-00" />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
                Senha
              </label>
              <div className="relative">
                <Input id="password" type={showPassword ? "text" : "password"} value={password}
                  onChange={(e) => setPassword(e.target.value)} placeholder="Mín. 8 caracteres" required className="pr-10" />
                <button type="button" tabIndex={-1} onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {password && (
                <ul className="mt-1.5 space-y-0.5">
                  {PASSWORD_RULES.map((r) => (
                    <li key={r.label} className={`text-xs flex items-center gap-1 ${r.test(password) ? "text-green-600" : "text-slate-400"}`}>
                      <span>{r.test(password) ? "✓" : "○"}</span> {r.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-600/10">
                {error}
              </p>
            )}

            <Button type="submit" disabled={submitting || !passwordValid} className="w-full">
              {submitting ? "Registrando..." : "Registrar"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
