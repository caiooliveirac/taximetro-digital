"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { MapPin, Sun, Moon, CheckCircle, Clock, Loader2, QrCode, AlertCircle, Plus, Building2, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavigationLinks } from "@/components/navigation-links";

type Assignment = {
  id: string;
  baseCode: string;
  baseName: string;
  baseLatitude: number;
  baseLongitude: number;
  period: string;
  status: string;
};

type CheckinData = {
  checkinId: string;
  code: string;
  qrDataUrl: string;
  expiresAt: string;
  geoDistance: number;
  selfie: string | null;
  internName: string;
};

type Step = "IDLE" | "GEO" | "TOTP" | "VALIDATED";

type Base = { id: string; code: string; name: string; type: string; isActive: boolean };

export default function InternCheckin() {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("IDLE");
  const [geoStatus, setGeoStatus] = useState("");
  const [checkinData, setCheckinData] = useState<CheckinData | null>(null);
  const [currentCode, setCurrentCode] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [msg, setMsg] = useState<{ type: "error" | "warning"; text: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);
  const sseRef = useRef<EventSource>(null);

  // Self-create state
  const [showSelfCreate, setShowSelfCreate] = useState(false);
  const [bases, setBases] = useState<Base[]>([]);
  const [selectedBase, setSelectedBase] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState<"DAY" | "NIGHT">("DAY");
  const [creating, setCreating] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    fetch(`/taximetro/api/assignments?from=${today}&to=${today}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success && json.data.length > 0) {
          const active = json.data.find((a: Assignment) =>
            a.status === "SCHEDULED" || a.status === "CONFIRMED"
          );
          setAssignment(active ?? null);
        }
        setLoading(false);
      });
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (sseRef.current) sseRef.current.close();
    };
  }, []);

  const startCountdown = useCallback((expiresAt: string) => {
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setCountdown(remaining);

      if (remaining <= 0) {
        setStep("IDLE");
        setMsg({ type: "warning", text: "Código expirou. Gere um novo código." });
        if (timerRef.current) clearInterval(timerRef.current);
        if (sseRef.current) sseRef.current.close();
      }
    }, 1000);

    // Set initial value
    setCountdown(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
  }, []);

  const startSSE = useCallback((assignmentId: string, attempt = 0) => {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource(`/taximetro/api/attendance/status/${assignmentId}`);
    es.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      if (data.status === "CHECKED_IN") {
        setStep("VALIDATED");
        if (timerRef.current) clearInterval(timerRef.current);
        es.close();
      }
    });
    es.onerror = () => {
      es.close();
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      setTimeout(() => startSSE(assignmentId, attempt + 1), delay);
    };
    sseRef.current = es;
  }, []);

  async function doCheckin() {
    if (!assignment) return;
    setStep("GEO");
    setGeoStatus("Obtendo localização...");
    setMsg(null);

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
        })
      );

      setGeoStatus(`Lat: ${pos.coords.latitude.toFixed(6)}, Lng: ${pos.coords.longitude.toFixed(6)}`);

      const res = await fetch("/taximetro/api/attendance/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId: assignment.id,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setCheckinData(json.data);
        setCurrentCode(json.data.code);
        setStep("TOTP");
        startCountdown(json.data.expiresAt);
        startSSE(assignment.id);
      } else {
        setMsg({ type: "error", text: json.error });
        setStep("IDLE");
      }
    } catch {
      setGeoStatus("");
      setMsg({ type: "error", text: "Não foi possível obter sua localização. Verifique as permissões do navegador." });
      setStep("IDLE");
    }
  }

  async function openSelfCreate() {
    setShowSelfCreate(true);
    if (bases.length === 0) {
      const res = await fetch("/taximetro/api/admin/bases");
      const json = await res.json();
      if (json.success) setBases(json.data.filter((b: Base) => b.isActive !== false));
    }
  }

  async function doSelfCreate() {
    if (!selectedBase) return;
    setCreating(true);
    setMsg(null);
    const res = await fetch("/taximetro/api/assignments/self-create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseId: selectedBase, period: selectedPeriod }),
    });
    const json = await res.json();
    if (json.success) {
      setAssignment(json.data);
      setShowSelfCreate(false);
      setMsg(null);
    } else {
      setMsg({ type: "error", text: json.error });
    }
    setCreating(false);
  }

  if (loading) return <p className="text-sm text-slate-400">Carregando...</p>;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-2xl font-semibold text-slate-900">Check-in</h1>

      {!assignment ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <p className="text-sm text-slate-400">Nenhum plantão pendente de check-in.</p>
          </div>

          {!showSelfCreate ? (
            <button
              onClick={openSelfCreate}
              className="w-full rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-5 text-center transition-colors hover:bg-amber-50"
            >
              <div className="flex items-center justify-center gap-2 text-amber-700">
                <Plus className="h-4 w-4" strokeWidth={2} />
                <span className="text-sm font-medium">Estou na base e meu plantão não aparece</span>
              </div>
              <p className="mt-1 text-xs text-amber-600/70">Crie o plantão manualmente para fazer check-in</p>
            </button>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50/30 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-4">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-amber-600" strokeWidth={1.5} />
                <h2 className="text-sm font-semibold text-amber-800">Criar plantão avulso</h2>
              </div>
              <p className="text-xs text-amber-700/70">
                Selecione a base e o turno. Um alerta será enviado à coordenação.
                O preceptor ainda precisará validar sua presença normalmente.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Base</label>
                  <select
                    value={selectedBase}
                    onChange={(e) => setSelectedBase(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
                  >
                    <option value="">Selecione a base...</option>
                    {bases.map((b) => (
                      <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Turno</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedPeriod("DAY")}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${selectedPeriod === "DAY"
                          ? "border-amber-300 bg-amber-100 text-amber-800"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                    >
                      <Sun className="h-4 w-4" strokeWidth={1.5} /> Diurno
                    </button>
                    <button
                      onClick={() => setSelectedPeriod("NIGHT")}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${selectedPeriod === "NIGHT"
                          ? "border-indigo-300 bg-indigo-100 text-indigo-800"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                    >
                      <Moon className="h-4 w-4" strokeWidth={1.5} /> Noturno
                    </button>
                  </div>
                </div>
              </div>

              {msg && (
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${msg.type === "error" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                  }`}>
                  <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  {msg.text}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => { setShowSelfCreate(false); setMsg(null); }}
                  className="flex-1"
                >
                  Cancelar
                </Button>
                <Button
                  onClick={doSelfCreate}
                  disabled={!selectedBase || creating}
                  className="flex-1 gap-2"
                >
                  {creating ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Criando...</>
                  ) : (
                    <><Plus className="h-4 w-4" strokeWidth={2} /> Criar Plantão</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : step === "VALIDATED" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center space-y-3">
          <CheckCircle className="mx-auto h-12 w-12 text-emerald-600" strokeWidth={1.5} />
          <p className="text-xl font-semibold text-emerald-800">Presença Confirmada</p>
          <p className="text-sm text-emerald-600">{assignment.baseCode} — {assignment.baseName}</p>
        </div>
      ) : step === "TOTP" && checkinData ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-5 text-center">
          <p className="text-sm text-slate-500">Mostre esta tela ao preceptor para validação</p>

          {/* Intern selfie + name */}
          <div className="flex items-center justify-center gap-3">
            {checkinData.selfie ? (
              <img src={checkinData.selfie} alt="Selfie" className="h-16 w-16 rounded-full object-cover border-2 border-accent-200" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 border-2 border-slate-200">
                <UserCircle className="h-10 w-10 text-slate-300" strokeWidth={1} />
              </div>
            )}
            <div className="text-left">
              <p className="font-semibold text-slate-900">{checkinData.internName}</p>
              <p className="text-xs text-slate-500">{assignment.baseCode} — {assignment.baseName}</p>
            </div>
          </div>

          {/* QR Code */}
          <div className="flex justify-center">
            <img src={checkinData.qrDataUrl} alt="QR Code" className="rounded-xl border border-slate-200" width={220} height={220} />
          </div>

          {/* Code */}
          <div className="space-y-1">
            <p className="font-mono text-5xl font-bold tracking-[0.3em] text-accent-700">{currentCode}</p>
            <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
              <Clock className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Expira em</span>
              <span className={`font-mono font-bold ${countdown <= 60 ? "text-red-500" : countdown <= 120 ? "text-amber-500" : "text-slate-900"}`}>
                {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, "0")}
              </span>
            </div>
          </div>

          {/* Progress bar (5 min = 300s) */}
          <div className="mx-auto h-1.5 w-48 overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${countdown <= 30 ? "bg-red-500 animate-pulse" : countdown <= 60 ? "bg-amber-500" : "bg-accent-500"
                }`}
              style={{ width: `${(countdown / 300) * 100}%` }}
            />
          </div>

          <div className="space-y-1 text-xs text-slate-400">
            <p>Distância: {checkinData.geoDistance}m</p>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-sm text-amber-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            Aguardando validação do preceptor...
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-slate-500">Base</p>
              <p className="mt-0.5 text-lg font-semibold text-slate-900">{assignment.baseCode}</p>
              <p className="text-sm text-slate-500">{assignment.baseName}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Turno</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-lg font-semibold text-slate-900">
                {assignment.period === "DAY"
                  ? <><Sun className="h-4 w-4 text-amber-500" strokeWidth={1.5} /> Diurno</>
                  : <><Moon className="h-4 w-4 text-indigo-500" strokeWidth={1.5} /> Noturno</>}
              </p>
            </div>
          </div>

          <NavigationLinks
            latitude={assignment.baseLatitude}
            longitude={assignment.baseLongitude}
            label={`${assignment.baseCode} - ${assignment.baseName}`}
          />

          {geoStatus && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <MapPin className="h-3 w-3" strokeWidth={1.5} /> {geoStatus}
            </p>
          )}

          {msg && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${msg.type === "error" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
              }`}>
              <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              {msg.text}
            </div>
          )}

          <Button
            onClick={doCheckin}
            disabled={step === "GEO"}
            className="w-full gap-2"
            size="lg"
          >
            {step === "GEO" ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Obtendo localização...</>
            ) : (
              <><MapPin className="h-4 w-4" strokeWidth={1.5} /> Iniciar Check-in</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
