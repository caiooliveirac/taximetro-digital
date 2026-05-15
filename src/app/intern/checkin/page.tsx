"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, useRef, useCallback, useOptimistic, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { MapPin, Sun, Moon, CheckCircle, Clock, Loader2, AlertCircle, UserCircle, AlertTriangle, LogOut, Shield, Settings, RotateCcw, Smartphone } from "lucide-react";
import { useSession } from "next-auth/react";
import { QRCodeCanvas } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { useImpersonate } from "@/components/impersonate/impersonate-provider";
import { saveObservationsAction } from "./actions";
import { NavigationLinks } from "@/components/navigation-links";
import { TOTP_STEP_SECONDS } from "@/lib/totp-config";
import { formatBrazilTime, getShiftLabel } from "@/lib/utils";

type Assignment = {
  id: string;
  baseId?: string;
  baseCode: string;
  baseName: string;
  baseLatitude: number;
  baseLongitude: number;
  date?: string;
  period: string;
  shift?: string | null;
  status: string;
  isExtraShift?: boolean;
  checkinStatus?: string | null;
};

type CheckinData = {
  checkinId: string;
  currentCode: string;
  expiresAt: string;
  assignmentId: string;
  geoDistance: number;
  selfie: string | null;
  internName: string;
};

type CheckoutData = {
  checkinId: string;
  currentCode: string;
  expiresAt: string;
  assignmentId: string;
  checkinAt: string | null;
  internName: string;
  baseCode: string;
  baseName: string;
};

type Step =
  | "IDLE" | "CHECKING_GEO" | "GPS_DENIED" | "GEO_WARNING" | "GENERATING" | "AWAITING"
  | "VALIDATED" | "CHECKOUT_GENERATING" | "CHECKOUT_AWAITING" | "CHECKED_OUT" | "ERROR";

type CurrentAttendancePayload = {
  current: {
    uiState: "NONE" | "IDLE" | "AWAITING" | "VALIDATED" | "CHECKOUT_AWAITING" | "CHECKED_OUT";
    assignment: Assignment;
    intern: {
      name: string;
      selfie: string | null;
    };
    checkinAt: string | null;
    checkoutAt: string | null;
    internObservations: string | null;
    session: {
      checkinId: string;
      currentCode: string;
      expiresAt: string;
    } | null;
    checkoutPending: boolean;
    canRequestCheckout: boolean;
  } | null;
  checkoutStatus?: {
    state: "NONE" | "PENDING" | "AWAITING" | "COMPLETED";
    assignment: Assignment | null;
    checkinAt: string | null;
    checkoutAt: string | null;
    internObservations: string | null;
    session: {
      checkinId: string;
      currentCode: string;
      expiresAt: string;
    } | null;
  };
};

const GROUP_NAME = "TaximetrosSAMUInternos";
const TOTP_STEP = TOTP_STEP_SECONDS;

function normalizeObservation(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : "";
}

export default function InternCheckin() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Carregando...</p>}>
      <InternCheckinContent />
    </Suspense>
  );
}

function InternCheckinContent() {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { target: impersonateTarget } = useImpersonate();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("IDLE");
  const [checkinData, setCheckinData] = useState<CheckinData | null>(null);
  const [checkoutData, setCheckoutData] = useState<CheckoutData | null>(null);
  const [currentCode, setCurrentCode] = useState("");
  const [countdown, setCountdown] = useState(TOTP_STEP);
  const [geoDistance, setGeoDistance] = useState<number | null>(null);
  const [geoFenceMeters, setGeoFenceMeters] = useState(200);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [errorText, setErrorText] = useState("");
  const [checkinAt, setCheckinAt] = useState<string | null>(null);
  const [canRequestCheckout, setCanRequestCheckout] = useState(false);
  const [internObservations, setInternObservations] = useState("");
  const [savedInternObservations, setSavedInternObservations] = useState("");
  const [optimisticSaved, setOptimisticSaved] = useOptimistic(savedInternObservations);
  const [isSavingObservations, startSaveObservationsTransition] = useTransition();
  const [observationsMsg, setObservationsMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);
  const sseRef = useRef<EventSource>(null);

  // QR value — opens the Telegram group directly
  const qrValue = `https://t.me/${GROUP_NAME}`;
  const normalizedInternObservations = normalizeObservation(internObservations);
  const normalizedOptimisticSavedObservations = normalizeObservation(optimisticSaved);

  // Step 3: Timer — code rotates every 90s
  const startCodeRotation = useCallback((checkinId: string, expiresAt: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    let lastFetchedStep = -1;

    const tick = async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const currentStep = Math.floor(nowSec / TOTP_STEP);
      const timeLeft = TOTP_STEP - (nowSec % TOTP_STEP);
      setCountdown(timeLeft);

      if (new Date() > new Date(expiresAt)) {
        setStep("ERROR");
        setErrorText("Sessão expirou. Inicie o check-in novamente.");
        if (timerRef.current) clearInterval(timerRef.current);
        if (sseRef.current) sseRef.current.close();
        return;
      }

      // Fetch new code from server when TOTP step changes
      if (currentStep !== lastFetchedStep) {
        lastFetchedStep = currentStep;
        try {
          const res = await fetch(`/taximetro/api/attendance/checkin/current-code?checkinId=${checkinId}`);
          const data = await res.json();
          if (data.success && data.code) {
            setCurrentCode(data.code);
          }
        } catch { /* keep current code */ }
      }
    };

    tick();
    timerRef.current = setInterval(tick, 1000);
  }, []);

  // Step 4: SSE — listen for preceptor validation
  const startSSE = useCallback(function startSSE(assignmentId: string, attempt = 0) {
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
      if (attempt < 10) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        setTimeout(() => startSSE(assignmentId, attempt + 1), delay);
      }
    };
    sseRef.current = es;
  }, []);

  // SSE for checkout — listen for CHECKED_OUT
  const startCheckoutSSE = useCallback(function startCheckoutSSE(assignmentId: string, attempt = 0) {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource(`/taximetro/api/attendance/status/${assignmentId}?after=CHECKED_IN`);
    es.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      if (data.status === "CHECKED_OUT") {
        setStep("CHECKED_OUT");
        if (timerRef.current) clearInterval(timerRef.current);
        es.close();
      }
    });
    es.onerror = () => {
      es.close();
      if (attempt < 10) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        setTimeout(() => startCheckoutSSE(assignmentId, attempt + 1), delay);
      }
    };
    sseRef.current = es;
  }, []);

  // Step 2: Generate TOTP on server
  const generateTotp = useCallback(async (lat: number, lng: number, geoValid: boolean) => {
    if (!assignment) return;
    setStep("GENERATING");

    try {
      const res = await fetch("/taximetro/api/attendance/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId: assignment.id,
          latitude: lat,
          longitude: lng,
          geoValid,
        }),
      });
      const data = await res.json();

      if (!data.success) {
        setErrorText(data.error || "Erro ao gerar código.");
        setStep("ERROR");
        return;
      }

      setCheckinData(data.data);
      setCurrentCode(data.data.currentCode);
      setCountdown(TOTP_STEP);
      setStep("AWAITING");

      startCodeRotation(data.data.checkinId, data.data.expiresAt);
      startSSE(data.data.assignmentId);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Erro de conexão. Verifique sua internet.");
      setStep("ERROR");
    }
  }, [assignment, startCodeRotation, startSSE]);

  // Step 1: Get geolocation and check against base
  const startCheckin = useCallback(async () => {
    if (!assignment) return;
    setStep("CHECKING_GEO");
    setErrorText("");

    if (!navigator.geolocation) {
      setUserCoords(null);
      setStep("GPS_DENIED");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setUserCoords({ lat: latitude, lng: longitude });

        try {
          const res = await fetch("/taximetro/api/attendance/checkin/geo-check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latitude, longitude, assignmentId: assignment.id }),
          });
          const data = await res.json();

          if (!data.success) {
            setGeoDistance(null);
            setGeoFenceMeters(200);
            setErrorText(data.error || "Erro ao verificar localização.");
            setStep("GEO_WARNING");
            return;
          }

          setGeoDistance(data.distanceMeters);
          setGeoFenceMeters(data.geoFenceMeters);

          if (data.withinFence) {
            await generateTotp(latitude, longitude, true);
          } else {
            setStep("GEO_WARNING");
          }
        } catch {
          setGeoDistance(null);
          setStep("GEO_WARNING");
        }
      },
      (err) => {
        // GPS denied or unavailable — show instructional screen
        setUserCoords(null);
        setStep("GPS_DENIED");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, [assignment, generateTotp]);

  // Checkout: generate TOTP via POST /api/attendance/checkout
  const startCheckout = useCallback(async () => {
    if (!assignment) return;
    setStep("CHECKOUT_GENERATING");
    setErrorText("");

    try {
      const res = await fetch("/taximetro/api/attendance/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: assignment.id }),
      });
      const data = await res.json();

      if (!data.success) {
        setErrorText(data.error || "Erro ao iniciar checkout.");
        setStep("ERROR");
        return;
      }

      setCheckoutData(data.data);
      setCurrentCode(data.data.currentCode);
      setCheckinAt(data.data.checkinAt);
      setCountdown(TOTP_STEP);
      setStep("CHECKOUT_AWAITING");

      startCodeRotation(data.data.checkinId, data.data.expiresAt);
      startCheckoutSSE(data.data.assignmentId);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Erro de conexão.");
      setStep("ERROR");
    }
  }, [assignment, startCodeRotation, startCheckoutSSE]);

  const saveObservations = useCallback(() => {
    if (!assignment) return;

    const nextValue = internObservations;
    setObservationsMsg(null);

    startSaveObservationsTransition(async () => {
      setOptimisticSaved(nextValue);
      try {
        const result = await saveObservationsAction({
          assignmentId: assignment.id,
          observations: nextValue,
        });

        if (!result.success) {
          setObservationsMsg({ type: "error", text: result.error || "Não foi possível salvar as observações." });
          return;
        }

        const savedValue = result.observations ?? "";
        setInternObservations(savedValue);
        setSavedInternObservations(savedValue);
        setObservationsMsg({ type: "success", text: "Observações salvas." });
      } catch {
        setObservationsMsg({ type: "error", text: "Erro de conexão. Tente novamente." });
      }
    });
  }, [assignment, internObservations, setOptimisticSaved]);


  useEffect(() => {
    let cancelled = false;

    async function loadCurrentAttendance() {
      try {
        const forcedAssignmentId = searchParams.get("assignmentId");
        const query = forcedAssignmentId ? `?assignmentId=${forcedAssignmentId}` : "";
        const res = await fetch(`/taximetro/api/attendance/current${query}`);
        const json = await res.json();
        if (!json.success || !json.data || cancelled) return;

        const data = json.data as CurrentAttendancePayload;
        if (!data.current) {
          setCanRequestCheckout(false);
          const pendingCheckout = data.checkoutStatus;
          if (pendingCheckout?.assignment && (pendingCheckout.state === "PENDING" || pendingCheckout.state === "AWAITING")) {
            setAssignment(pendingCheckout.assignment);
            setCheckinAt(pendingCheckout.checkinAt);
            setCanRequestCheckout(pendingCheckout.state === "PENDING");
            setInternObservations(pendingCheckout.internObservations ?? "");
            setSavedInternObservations(pendingCheckout.internObservations ?? "");

            if (pendingCheckout.state === "PENDING") {
              setStep("VALIDATED");
              return;
            }

            if (pendingCheckout.state === "AWAITING" && pendingCheckout.session) {
              const restoredCheckout: CheckoutData = {
                checkinId: pendingCheckout.session.checkinId,
                currentCode: pendingCheckout.session.currentCode,
                expiresAt: pendingCheckout.session.expiresAt,
                assignmentId: pendingCheckout.assignment.id,
                checkinAt: pendingCheckout.checkinAt,
                internName: session?.user?.name ?? "",
                baseCode: pendingCheckout.assignment.baseCode,
                baseName: pendingCheckout.assignment.baseName,
              };
              setCheckoutData(restoredCheckout);
              setCurrentCode(pendingCheckout.session.currentCode);
              setCountdown(TOTP_STEP);
              setStep("CHECKOUT_AWAITING");
              startCodeRotation(pendingCheckout.session.checkinId, pendingCheckout.session.expiresAt);
              startCheckoutSSE(pendingCheckout.assignment.id);
              return;
            }
          }

          setAssignment(null);
          setInternObservations("");
          setSavedInternObservations("");
          setObservationsMsg(null);
          return;
        }

        setAssignment(data.current.assignment);
        setCheckinAt(data.current.checkinAt);
        setCanRequestCheckout(data.current.canRequestCheckout);
        setInternObservations(data.current.internObservations ?? "");
        setSavedInternObservations(data.current.internObservations ?? "");

        if (data.current.uiState === "VALIDATED") {
          setStep("VALIDATED");
          return;
        }

        if (data.current.uiState === "CHECKED_OUT") {
          setStep("CHECKED_OUT");
          return;
        }

        if (data.current.uiState === "AWAITING" && data.current.session) {
          const restoredCheckin: CheckinData = {
            checkinId: data.current.session.checkinId,
            currentCode: data.current.session.currentCode,
            expiresAt: data.current.session.expiresAt,
            assignmentId: data.current.assignment.id,
            geoDistance: 0,
            selfie: data.current.intern.selfie,
            internName: data.current.intern.name,
          };
          setCheckinData(restoredCheckin);
          setCurrentCode(data.current.session.currentCode);
          setCountdown(TOTP_STEP);
          setStep("AWAITING");
          startCodeRotation(data.current.session.checkinId, data.current.session.expiresAt);
          startSSE(data.current.assignment.id);
          return;
        }

        if (data.current.uiState === "CHECKOUT_AWAITING" && data.current.session) {
          const restoredCheckout: CheckoutData = {
            checkinId: data.current.session.checkinId,
            currentCode: data.current.session.currentCode,
            expiresAt: data.current.session.expiresAt,
            assignmentId: data.current.assignment.id,
            checkinAt: data.current.checkinAt,
            internName: data.current.intern.name,
            baseCode: data.current.assignment.baseCode,
            baseName: data.current.assignment.baseName,
          };
          setCheckoutData(restoredCheckout);
          setCurrentCode(data.current.session.currentCode);
          setCountdown(TOTP_STEP);
          setStep("CHECKOUT_AWAITING");
          startCodeRotation(data.current.session.checkinId, data.current.session.expiresAt);
          startCheckoutSSE(data.current.assignment.id);
        }
      } catch {
        if (!cancelled) {
          setAssignment(null);
          setCanRequestCheckout(false);
          setInternObservations("");
          setSavedInternObservations("");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadCurrentAttendance();

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (sseRef.current) sseRef.current.close();
    };
  }, [searchParams, session?.user?.name, startCheckoutSSE, startCodeRotation, startSSE]);

  const canManageAssignment = session?.user?.role === "COORDINATOR" || session?.user?.role === "LEADER";
  const reassignmentHref = session?.user?.role === "COORDINATOR"
    ? `/admin/remanejamento?assignmentId=${assignment?.id ?? ""}`
    : `/leader/remanejamento?assignmentId=${assignment?.id ?? ""}`;
  const showInternGuidance = session?.user?.role === "INTERN" && !impersonateTarget;

  if (loading) return <p className="text-sm text-slate-400">Carregando...</p>;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-2xl font-semibold text-slate-900">Check-in</h1>

      {/* No assignment */}
      {!assignment ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            <p className="text-sm text-slate-400">Nenhum plantão pendente de check-in.</p>
            <p className="mt-2 text-xs text-slate-500">Se você estiver escalado e o plantão não aparecer, peça a alocação ao líder ou à coordenação.</p>
          </div>
        </div>

        /* Validated — On Duty — show checkout button */
      ) : step === "VALIDATED" ? (
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-6 space-y-4">
            <div className="flex items-center justify-center gap-2">
              <Shield className="h-6 w-6 text-emerald-600" strokeWidth={1.5} />
              <p className="text-xl font-bold text-emerald-800">Em Plantão</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg bg-white/70 p-3">
                <p className="text-xs font-medium text-slate-500">Base</p>
                <p className="text-lg font-bold text-slate-900">{assignment.baseCode}</p>
                <p className="text-xs text-slate-500">{assignment.baseName}</p>
              </div>
              <div className="rounded-lg bg-white/70 p-3">
                <p className="text-xs font-medium text-slate-500">Turno</p>
                <p className="text-lg font-bold text-slate-900 flex items-center justify-center gap-1">
                  {assignment.shift
                    ? <><Sun className="h-4 w-4 text-amber-500" strokeWidth={1.5} /> {getShiftLabel(assignment.shift)}</>
                    : assignment.period === "DAY"
                      ? <><Sun className="h-4 w-4 text-amber-500" strokeWidth={1.5} /> Diurno</>
                      : <><Moon className="h-4 w-4 text-indigo-500" strokeWidth={1.5} /> Noturno</>}
                </p>
              </div>
            </div>

            {checkinAt && (
              <div className="flex items-center justify-center gap-1.5 text-sm text-emerald-700">
                <CheckCircle className="h-4 w-4" strokeWidth={1.5} />
                Check-in validado às {formatBrazilTime(checkinAt)}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Registro de ocorrências clínicas é obrigatório durante o plantão.
            <Link href="/taximetro/intern/ocorrencias" className="ml-1 font-semibold underline underline-offset-2">
              Registrar ocorrências agora
            </Link>
          </div>

          {canRequestCheckout ? (
            <>
              <Button
                onClick={startCheckout}
                size="lg"
                className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white text-lg py-6"
              >
                <LogOut className="h-5 w-5" strokeWidth={2} />
                Solicitar Checkout
              </Button>
              <p className="text-xs text-center text-slate-400">
                Ao final do plantão, solicite checkout. O preceptor validará via Telegram.
              </p>
            </>
          ) : (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-4 text-center text-sm text-blue-900">
              {assignment.shift && assignment.period === "DAY"
                ? "O checkout deste plantão está disponível desde 05:00 e permanece até 00:00."
                : assignment.period === "DAY"
                  ? "O checkout do plantão diurno fica liberado a partir das 15:00 e permanece disponível até 00:00."
                  : "O checkout do plantão noturno fica liberado a partir das 06:00 e permanece disponível até 12:00."}
            </div>
          )}

          {canManageAssignment && assignment && (
            <Button asChild variant="outline" className="w-full gap-2">
              <Link href={reassignmentHref}>
                <Settings className="h-4 w-4" strokeWidth={1.5} /> Ajustar base deste plantão
              </Link>
            </Button>
          )}

          {showInternGuidance && (
            <p className="text-xs text-center text-slate-500">
              Se a base exibida não estiver correta, você pode seguir com o check-in normalmente caso não consiga contato com o líder de escala e avisá-lo assim que possível.
            </p>
          )}
        </div>

        /* Checkout generating TOTP */
      ) : step === "CHECKOUT_GENERATING" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)] text-center space-y-4">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-blue-500" strokeWidth={1.5} />
          <p className="text-slate-600">Gerando código de checkout...</p>
        </div>

        /* Checkout awaiting — QR + TOTP */
      ) : step === "CHECKOUT_AWAITING" && checkoutData ? (
        <div className="rounded-xl border-2 border-blue-200 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-5 text-center">
          <div className="rounded-3xl border-2 border-blue-400 bg-blue-50 px-5 py-5 text-center shadow-sm">
            <p className="text-base font-black uppercase tracking-[0.22em] text-blue-950">Preceptor</p>
            <p className="mt-3 text-lg font-black leading-tight text-blue-950">
              ESTE QR CODE É SOMENTE O LINK DO GRUPO.
            </p>
            <p className="mt-2 text-lg font-black leading-tight text-blue-950">
              O PRECEPTOR PRECISA DIGITAR ESSE CÓDIGO LÁ.
            </p>
            <p className="mt-2 text-sm font-black uppercase tracking-[0.18em] text-blue-800">
              SOMENTE O CÓDIGO E MAIS NADA.
            </p>
            <div className="mt-4 rounded-2xl border-2 border-blue-300 bg-white px-3 py-4 text-center">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-blue-700">Enviar no grupo</p>
              <p className="mt-2 font-mono text-6xl font-black tracking-[0.34em] text-blue-700 sm:text-7xl">{currentCode}</p>
            </div>
            <p className="mt-4 text-base font-black uppercase text-blue-950">
              Somente <span className="font-mono">{currentCode}</span>
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-lg font-bold text-blue-800">Checkout</p>
            <p className="text-sm text-slate-500">{assignment.baseCode} — {assignment.baseName}</p>
          </div>

          {/* QR Code — opens Telegram group */}
          <div className="flex justify-center">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <QRCodeCanvas value={qrValue} size={200} level="M" includeMargin />
            </div>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-center text-sm font-semibold uppercase text-blue-900">
            Este QR Code é somente o link do grupo.
          </div>

          {/* Circular timer */}
          <div className="flex items-center justify-center gap-2">
            <svg className="h-8 w-8 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="16" fill="none" stroke="#e5e7eb" strokeWidth="3" />
              <circle cx="18" cy="18" r="16" fill="none" stroke="#3b82f6" strokeWidth="3"
                strokeDasharray={`${(countdown / TOTP_STEP) * 100.5} 100.5`} strokeLinecap="round" />
            </svg>
            <span className="text-sm text-slate-600">
              Novo código em <span className="font-mono font-bold">{countdown}s</span>
            </span>
          </div>

          <div className="rounded-xl bg-blue-100 p-4 text-center text-sm font-semibold text-blue-900">
            <p>Se o grupo já estiver aberto, envie somente <span className="font-mono font-black">{currentCode}</span>.</p>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-sm text-blue-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            Aguardando confirmação do preceptor...
          </div>
        </div>

        /* Checked out — done */
      ) : step === "CHECKED_OUT" ? (
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-6 text-center space-y-3">
            <CheckCircle className="mx-auto h-12 w-12 text-blue-600" strokeWidth={1.5} />
            <p className="text-xl font-semibold text-blue-800">Checkout Realizado</p>
            <p className="text-sm text-blue-600">{assignment.baseCode} — {assignment.baseName}</p>
            <p className="text-xs text-slate-500">Se quiser, registre abaixo observações facultativas sobre o plantão encerrado.</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Observações</p>
              <p className="mt-1 text-xs text-slate-500">Campo opcional disponível após o checkout.</p>
            </div>
            <textarea
              value={internObservations}
              onChange={(e) => {
                setInternObservations(e.target.value);
                if (observationsMsg) setObservationsMsg(null);
              }}
              placeholder="Observações sobre o plantão"
              maxLength={2000}
              rows={5}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
            />
            {observationsMsg && (
              <div className={`rounded-lg px-3 py-2 text-sm ${observationsMsg.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                {observationsMsg.text}
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-400">{internObservations.length}/2000</p>
              <Button
                variant="outline"
                onClick={saveObservations}
                disabled={isSavingObservations || normalizedInternObservations === normalizedOptimisticSavedObservations}
                className="gap-2"
              >
                {isSavingObservations ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</> : "Salvar observações"}
              </Button>
            </div>
          </div>
        </div>

        /* Checking geo */
      ) : step === "CHECKING_GEO" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)] text-center space-y-4">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-accent-500" strokeWidth={1.5} />
          <p className="text-slate-600">Verificando sua localização...</p>
        </div>

        /* GPS Denied — instructional screen */
      ) : step === "GPS_DENIED" ? (
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-orange-300 bg-orange-50 p-6 space-y-4">
            <div className="flex items-center justify-center gap-2">
              <MapPin className="h-8 w-8 text-orange-600" strokeWidth={1.5} />
              <p className="text-lg font-bold text-orange-800">GPS Desativado</p>
            </div>

            <p className="text-sm text-orange-700 text-center">
              Precisamos da sua localização para registrar o check-in na base.
              Por favor, ative o GPS e permita o acesso:
            </p>

            <div className="rounded-lg bg-white p-4 space-y-3 text-sm text-slate-700">
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">1</div>
                <p>Toque no <strong>cadeado</strong> (🔒) ou <strong>ícone ⓘ</strong> na barra de endereço do navegador</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">2</div>
                <p>Em <strong>Localização</strong>, altere para <strong>Permitir</strong></p>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700">3</div>
                <p>Verifique se o <strong>GPS do celular</strong> está ligado (Configurações → Localização)</p>
              </div>
            </div>

            <div className="rounded-lg bg-orange-100/50 p-3 text-xs text-orange-700 text-center">
              <Smartphone className="inline h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
              No iPhone: Ajustes → Privacidade → Serviços de Localização → Safari → &quot;Durante o Uso&quot;
            </div>
          </div>

          <Button onClick={startCheckin} className="w-full gap-2" size="lg">
            <RotateCcw className="h-4 w-4" strokeWidth={2} />
            Tentar novamente
          </Button>

          <button
            onClick={() => generateTotp(0, 0, false)}
            className="w-full text-center text-sm text-slate-400 underline underline-offset-2 hover:text-slate-600"
          >
            Continuar sem localização
          </button>
        </div>

        /* Geo warning — outside fence */
      ) : step === "GEO_WARNING" ? (
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-6 text-center space-y-3">
            <AlertTriangle className="mx-auto h-10 w-10 text-amber-600" strokeWidth={1.5} />
            {geoDistance != null ? (
              <>
                <p className="text-lg font-bold text-amber-800">Fora do raio da base</p>
                <p className="text-amber-700">
                  Você está a <strong>{geoDistance.toFixed(0)}m</strong> da base.
                  O raio permitido é <strong>{geoFenceMeters}m</strong>.
                </p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-amber-800">Localização indisponível</p>
                <p className="text-amber-700">
                  {errorText || "Não foi possível verificar sua localização."}
                </p>
              </>
            )}
          </div>
          <p className="text-sm text-slate-500 text-center">
            {geoDistance != null
              ? "Sua localização pode estar imprecisa. Deseja continuar? O check-in ficará registrado como fora do raio."
              : "Você pode continuar sem verificação de localização."}
          </p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep("IDLE")} className="flex-1">
              Cancelar
            </Button>
            <Button
              onClick={() => generateTotp(userCoords?.lat ?? 0, userCoords?.lng ?? 0, false)}
              className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
            >
              Continuar mesmo assim
            </Button>
          </div>
        </div>

        /* Generating TOTP */
      ) : step === "GENERATING" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)] text-center space-y-4">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-accent-500" strokeWidth={1.5} />
          <p className="text-slate-600">Gerando código de presença...</p>
        </div>

        /* Awaiting preceptor — QR + TOTP */
      ) : step === "AWAITING" && checkinData ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-5 text-center">

          <div className="rounded-3xl border-2 border-accent-400 bg-accent-50 px-5 py-5 text-center shadow-sm">
            <p className="text-base font-black uppercase tracking-[0.22em] text-accent-950">Preceptor</p>
            <p className="mt-3 text-lg font-black leading-tight text-accent-950">
              ESTE QR CODE É SOMENTE O LINK DO GRUPO.
            </p>
            <p className="mt-2 text-lg font-black leading-tight text-accent-950">
              O PRECEPTOR PRECISA DIGITAR ESSE CÓDIGO LÁ.
            </p>
            <p className="mt-2 text-sm font-black uppercase tracking-[0.18em] text-accent-800">
              SOMENTE O CÓDIGO E MAIS NADA.
            </p>
            <div className="mt-4 rounded-2xl border-2 border-accent-300 bg-white px-3 py-4 text-center">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-accent-700">Enviar no grupo</p>
              <p className="mt-2 font-mono text-6xl font-black tracking-[0.34em] text-accent-700 sm:text-7xl">{currentCode}</p>
            </div>
            <p className="mt-4 text-base font-black uppercase text-accent-950">
              Somente <span className="font-mono">{currentCode}</span>
            </p>
          </div>

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

          {/* QR Code — opens Telegram group */}
          {qrValue && (
            <div className="flex justify-center">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <QRCodeCanvas value={qrValue} size={220} level="M" includeMargin />
              </div>
            </div>
          )}

          <div className="rounded-xl border border-accent-200 bg-accent-50/70 px-4 py-3 text-center text-sm font-semibold uppercase text-accent-900">
            Este QR Code é somente o link do grupo.
          </div>

          {/* Circular timer */}
          <div className="flex items-center justify-center gap-2">
            <svg className="h-8 w-8 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="16" fill="none" stroke="#e5e7eb" strokeWidth="3" />
              <circle cx="18" cy="18" r="16" fill="none" stroke="#f97316" strokeWidth="3"
                strokeDasharray={`${(countdown / TOTP_STEP) * 100.5} 100.5`} strokeLinecap="round" />
            </svg>
            <span className="text-sm text-slate-600">
              Novo código em <span className="font-mono font-bold">{countdown}s</span>
            </span>
          </div>

          {checkinData.geoDistance > 0 && (
            <p className="text-xs text-slate-400">Distância: {checkinData.geoDistance}m</p>
          )}

          {/* Alternative */}
          <div className="rounded-xl bg-accent-100 p-4 text-center text-sm font-semibold text-accent-900">
            <p>Se o grupo já estiver aberto, envie somente <span className="font-mono font-black">{currentCode}</span>.</p>
          </div>

          <div className="flex items-center justify-center gap-1.5 text-sm text-amber-600">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            Aguardando validação do preceptor...
          </div>
        </div>

        /* Error */
      ) : step === "ERROR" ? (
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-red-300 bg-red-50 p-6 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-red-500 mb-2" strokeWidth={1.5} />
            <p className="text-red-700">{errorText}</p>
          </div>
          <Button variant="outline" className="w-full" onClick={() => { setStep("IDLE"); setErrorText(""); }}>
            Tentar novamente
          </Button>
        </div>

        /* IDLE — ready to check in */
      ) : (
        <div className="space-y-4">
          {assignment.isExtraShift && (
            <div className="flex items-center justify-center gap-2 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
              <AlertTriangle className="h-5 w-5 text-amber-600" strokeWidth={1.5} />
              <span className="text-lg font-bold uppercase tracking-wide text-amber-900">Plantão Extra</span>
            </div>
          )}
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
                  {assignment.shift
                    ? <><Sun className="h-4 w-4 text-amber-500" strokeWidth={1.5} /> {getShiftLabel(assignment.shift)}</>
                    : assignment.period === "DAY"
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

            {assignment.isExtraShift ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" strokeWidth={1.5} />
                  <span className="inline-flex items-center rounded-full bg-amber-200 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-900">Plantão Extra</span>
                </div>
                <p className="text-sm font-semibold text-amber-900">
                  Este é um plantão extra e não será contabilizado no seu rodízio oficial. Não há necessidade de fazer check-in pelo sistema.
                </p>
                <p className="text-xs text-amber-700">
                  Compareça normalmente à base e siga as orientações do preceptor.
                </p>
              </div>
            ) : (
              <Button onClick={startCheckin} className="w-full gap-2" size="lg">
                <MapPin className="h-4 w-4" strokeWidth={1.5} /> Iniciar Check-in
              </Button>
            )}

            {canManageAssignment && assignment && (
              <Button asChild variant="outline" className="w-full gap-2">
                <Link href={reassignmentHref}>
                  <Settings className="h-4 w-4" strokeWidth={1.5} /> Ajustar base deste plantão
                </Link>
              </Button>
            )}
          </div>

          {showInternGuidance && (
            <p className="px-1 text-xs leading-5 text-slate-500">
              Se a base exibida não estiver correta, você pode tocar em check-in normalmente caso não consiga contato com o líder de escala e avisá-lo assim que possível.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
