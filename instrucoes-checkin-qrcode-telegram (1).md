# Instruções para o Copilot — Fluxo de Check-in: QR Code → Grupo do Telegram com código pré-digitado

> **Cole este arquivo inteiro no contexto do Copilot antes de pedir a implementação do check-in.**

---

## O problema que estávamos tendo

O QR code gerado no check-in usava `https://t.me/NomeDoBot?start=CODIGO`, que:
- Abria o **navegador** sugerindo instalar o Telegram (mesmo com o app instalado)
- Abria chat **privado** com o bot, não o grupo
- Qualquer pessoa que escaneasse podia validar (zero segurança)

## A solução

O QR code agora codifica:

```
https://t.me/TaximetrosSAMUInternos?text=CODIGO
```

Isso é um **deep link oficial do Telegram** (documentado em https://core.telegram.org/api/links, seção "Public username links") que:

1. Abre o Telegram **nativo** direto (iOS e Android), sem passar pelo navegador
2. Abre **o grupo** `@TaximetrosSAMUInternos`, não o bot
3. Preenche o campo de texto com o código de 6 dígitos
4. O preceptor só toca no botão de **enviar** (➤)
5. O bot que está no grupo lê os 6 dígitos e valida

**Segurança**: só membros do grupo conseguem enviar mensagens. Se alguém de fora escanear o QR, o Telegram abre o perfil do grupo mas não permite enviar nada. A segurança está na membership do grupo, que o coordenador controla manualmente.

---

## Dados fixos

```
Username do grupo:  TaximetrosSAMUInternos
Variável de ambiente: NEXT_PUBLIC_TELEGRAM_GROUP_USERNAME=TaximetrosSAMUInternos
```

---

## Fluxo completo (passo a passo que o código deve implementar)

```
INTERNO toca "Check-in"
  │
  ├─ Browser pede geolocalização (enableHighAccuracy: true)
  │
  ├─ POST /api/attendance/checkin/geo-check  { latitude, longitude }
  │   └─ Servidor calcula Haversine entre interno e base do assignment de hoje
  │
  ├─ SE distância <= geoFenceMeters:
  │   └─ Prossegue para gerar TOTP
  │
  ├─ SE distância > geoFenceMeters:
  │   ├─ Mostra: "Você está a Xm da base. O raio é Ym."
  │   ├─ Botão "Cancelar"
  │   └─ Botão "Continuar mesmo assim"
  │       └─ Prossegue para gerar TOTP com geoValid=false
  │
  ├─ POST /api/attendance/checkin  { latitude, longitude, geoValid }
  │   └─ Servidor: cria checkin + qr_session + gera TOTP secret
  │   └─ Retorna: { checkinId, currentCode, expiresAt, assignmentId, baseName }
  │
  └─ TELA "Aguardando preceptor":
      │
      ├─ QR CODE grande (220px) codificando:
      │   https://t.me/TaximetrosSAMUInternos?text=CODIGO
      │
      ├─ Código numérico grande: 1 2 3 4 5 6
      │   (font-mono, text-4xl, tracking-[0.3em])
      │
      ├─ Timer circular: "Novo código em XXs"
      │   (código rotaciona a cada 90 segundos)
      │
      ├─ QUANDO código rotaciona:
      │   ├─ Buscar novo código: GET /api/attendance/checkin/current-code?checkinId=X
      │   ├─ Atualizar currentCode no state
      │   └─ QR code re-renderiza automaticamente (novo valor no QRCodeCanvas)
      │
      ├─ SSE em /api/attendance/status/{assignmentId}
      │   └─ Quando recebe { status: "VALIDATED" }: muda tela para "Presença confirmada ✓"
      │   └─ Se SSE falhar: polling GET a cada 5s como fallback
      │
      └─ Texto alternativo: "O preceptor também pode digitar CODIGO direto no grupo"
```

---

## Componente React — `src/app/intern/checkin/page.tsx`

```tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react"; // npm install qrcode.react

type CheckinState =
  | "IDLE"
  | "CHECKING_GEO"
  | "GEO_WARNING"
  | "GENERATING"
  | "AWAITING"
  | "VALIDATED"
  | "ERROR";

interface TotpData {
  checkinId: string;
  currentCode: string;
  expiresAt: string;
  assignmentId: string;
  baseName: string;
  baseCode: string;
}

const GROUP_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_GROUP_USERNAME || "TaximetrosSAMUInternos";

export default function CheckinPage() {
  const [state, setState] = useState<CheckinState>("IDLE");
  const [geoDistance, setGeoDistance] = useState<number | null>(null);
  const [geoFenceMeters, setGeoFenceMeters] = useState<number>(200);
  const [totpData, setTotpData] = useState<TotpData | null>(null);
  const [currentCode, setCurrentCode] = useState<string>("");
  const [countdown, setCountdown] = useState<number>(90);
  const [error, setError] = useState<string>("");
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  // =============================================
  // O LINK DO QR CODE — abre o GRUPO com código
  // =============================================
  const qrValue = `https://t.me/${GROUP_USERNAME}?text=${currentCode}`;

  // =============================================
  // PASSO 1: Geolocalização
  // =============================================
  const startCheckin = useCallback(async () => {
    setState("CHECKING_GEO");
    setError("");

    if (!navigator.geolocation) {
      setError("Seu navegador não suporta geolocalização.");
      setState("ERROR");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setUserCoords({ lat: latitude, lng: longitude });

        try {
          const res = await fetch("/api/attendance/checkin/geo-check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latitude, longitude }),
          });
          const data = await res.json();

          if (!data.success) {
            setError(data.error || "Erro ao verificar localização.");
            setState("ERROR");
            return;
          }

          setGeoDistance(data.distanceMeters);
          setGeoFenceMeters(data.geoFenceMeters);

          if (data.withinFence) {
            await generateTotp(latitude, longitude, true);
          } else {
            setState("GEO_WARNING");
          }
        } catch {
          setError("Erro de conexão ao verificar localização.");
          setState("ERROR");
        }
      },
      (geoError) => {
        const msgs: Record<number, string> = {
          1: "Permissão de localização negada. Ative nas configurações do celular.",
          2: "Não foi possível obter sua localização. Tente novamente.",
          3: "Tempo esgotado. Tente em local com melhor sinal.",
        };
        setError(msgs[geoError.code] || "Erro de geolocalização.");
        setState("ERROR");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  // =============================================
  // PASSO 2: Gerar TOTP no servidor
  // =============================================
  const generateTotp = useCallback(async (lat: number, lng: number, geoValid: boolean) => {
    setState("GENERATING");
    try {
      const res = await fetch("/api/attendance/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: lat, longitude: lng, geoValid }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || "Erro ao gerar código.");
        setState("ERROR");
        return;
      }

      setTotpData(data.data);
      setCurrentCode(data.data.currentCode);
      setCountdown(90);
      setState("AWAITING");

      startCodeRotation(data.data.checkinId, data.data.expiresAt);
      startSSE(data.data.assignmentId);
    } catch {
      setError("Erro de conexão. Verifique sua internet.");
      setState("ERROR");
    }
  }, []);

  // =============================================
  // PASSO 3: Timer — código rotaciona a cada 90s
  // =============================================
  const startCodeRotation = useCallback((checkinId: string, expiresAt: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    const step = 90;
    let lastFetchedStep = -1;

    const tick = async () => {
      const now = Math.floor(Date.now() / 1000);
      const currentStep = Math.floor(now / step);
      const timeLeft = step - (now % step);
      setCountdown(timeLeft);

      if (new Date() > new Date(expiresAt)) {
        setState("ERROR");
        setError("Sessão expirou (30 min). Inicie o check-in novamente.");
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }

      // Buscar novo código do servidor só quando o step muda
      if (currentStep !== lastFetchedStep) {
        lastFetchedStep = currentStep;
        try {
          const res = await fetch(`/api/attendance/checkin/current-code?checkinId=${checkinId}`);
          const data = await res.json();
          if (data.success && data.code) {
            setCurrentCode(data.code);
          }
        } catch { /* manter código atual */ }
      }
    };

    tick();
    timerRef.current = setInterval(tick, 1000);
  }, []);

  // =============================================
  // PASSO 4: SSE — ouvir validação do preceptor
  // =============================================
  const startSSE = useCallback((assignmentId: string) => {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource(`/api/attendance/status/${assignmentId}`);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status === "VALIDATED") {
          setState("VALIDATED");
          cleanup();
        }
      } catch { /* ignorar */ }
    };

    es.onerror = () => {
      es.close();
      // Fallback polling
      const poll = setInterval(async () => {
        try {
          const res = await fetch(`/api/attendance/checkin/status?assignmentId=${assignmentId}`);
          const data = await res.json();
          if (data.status === "VALIDATED") {
            setState("VALIDATED");
            clearInterval(poll);
            cleanup();
          }
        } catch { /* silencioso */ }
      }, 5000);
    };

    sseRef.current = es;
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (sseRef.current) sseRef.current.close();
  }, []);

  useEffect(() => cleanup, [cleanup]);

  // =============================================
  // RENDER
  // =============================================
  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-6">

      {state === "IDLE" && (
        <div className="flex flex-col items-center gap-6 mt-12">
          <h1 className="text-2xl font-bold text-center">Check-in de Presença</h1>
          <p className="text-gray-600 text-center max-w-sm">
            Toque no botão abaixo. Será necessário permitir acesso à sua localização.
          </p>
          <button
            onClick={startCheckin}
            className="w-full max-w-xs bg-blue-600 text-white py-4 rounded-xl text-lg font-semibold active:bg-blue-700 transition-colors"
          >
            Iniciar Check-in
          </button>
        </div>
      )}

      {state === "CHECKING_GEO" && (
        <div className="flex flex-col items-center gap-4 mt-12">
          <div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full" />
          <p className="text-gray-600">Verificando sua localização...</p>
        </div>
      )}

      {state === "GEO_WARNING" && (
        <div className="flex flex-col items-center gap-6 mt-8 max-w-sm">
          <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-6 text-center">
            <p className="text-amber-800 font-bold text-lg mb-2">Fora do raio da base</p>
            <p className="text-amber-700">
              Você está a <strong>{geoDistance?.toFixed(0)}m</strong> da base.
              O raio permitido é <strong>{geoFenceMeters}m</strong>.
            </p>
          </div>
          <p className="text-gray-600 text-center text-sm">
            Sua localização pode estar imprecisa. Deseja continuar?
            O check-in ficará registrado como fora do raio.
          </p>
          <div className="flex gap-3 w-full">
            <button
              onClick={() => setState("IDLE")}
              className="flex-1 border-2 border-gray-300 py-3 rounded-xl font-medium text-gray-600"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                if (userCoords) generateTotp(userCoords.lat, userCoords.lng, false);
              }}
              className="flex-1 bg-amber-500 text-white py-3 rounded-xl font-medium active:bg-amber-600 transition-colors"
            >
              Continuar mesmo assim
            </button>
          </div>
        </div>
      )}

      {state === "GENERATING" && (
        <div className="flex flex-col items-center gap-4 mt-12">
          <div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full" />
          <p className="text-gray-600">Gerando código de presença...</p>
        </div>
      )}

      {state === "AWAITING" && (
        <div className="flex flex-col items-center gap-5 mt-4 w-full max-w-sm">
          <h1 className="text-xl font-bold text-center">Mostre ao preceptor</h1>

          {/* QR CODE — abre o grupo com código pronto */}
          <div className="bg-white p-4 rounded-2xl shadow-lg">
            <QRCodeCanvas value={qrValue} size={220} level="M" includeMargin />
          </div>

          <p className="text-gray-500 text-sm text-center px-4">
            Preceptor aponta a câmera → Telegram abre no grupo
            com o código pronto → só tocar em enviar
          </p>

          {/* Código numérico */}
          <div className="bg-gray-50 rounded-xl p-6 text-center w-full">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
              Código de presença
            </p>
            <p className="text-4xl font-mono font-bold tracking-[0.3em] text-gray-900">
              {currentCode}
            </p>
          </div>

          {/* Timer */}
          <div className="flex items-center gap-2">
            <svg className="h-8 w-8 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="16" fill="none" stroke="#e5e7eb" strokeWidth="3" />
              <circle cx="18" cy="18" r="16" fill="none" stroke="#3b82f6" strokeWidth="3"
                strokeDasharray={`${(countdown / 90) * 100.5} 100.5`} strokeLinecap="round" />
            </svg>
            <span className="text-sm text-gray-600">
              Novo código em <span className="font-mono font-bold">{countdown}s</span>
            </span>
          </div>

          {/* Alternativa manual */}
          <div className="bg-blue-50 rounded-xl p-4 text-center text-sm text-blue-800 w-full">
            <p className="font-medium mb-1">Alternativa</p>
            <p>
              O preceptor pode digitar{" "}
              <span className="font-mono font-bold">{currentCode}</span>{" "}
              direto no grupo do Telegram
            </p>
          </div>
        </div>
      )}

      {state === "VALIDATED" && (
        <div className="flex flex-col items-center gap-6 mt-12">
          <div className="h-20 w-20 bg-green-100 rounded-full flex items-center justify-center">
            <span className="text-4xl">✓</span>
          </div>
          <h1 className="text-2xl font-bold text-green-700">Presença confirmada!</h1>
          <p className="text-gray-600 text-center">
            O preceptor validou sua presença. Bom plantão!
          </p>
        </div>
      )}

      {state === "ERROR" && (
        <div className="flex flex-col items-center gap-6 mt-12 max-w-sm">
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-6 text-center">
            <p className="text-red-700">{error}</p>
          </div>
          <button
            onClick={() => { setState("IDLE"); setError(""); }}
            className="bg-gray-100 text-gray-700 py-3 px-8 rounded-xl font-medium"
          >
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## API Route — código TOTP atualizado

### `GET /api/attendance/checkin/current-code`

```typescript
// src/app/api/attendance/checkin/current-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authenticator } from "otplib";

authenticator.options = { step: 90, window: 1 };

export async function GET(req: NextRequest) {
  const checkinId = req.nextUrl.searchParams.get("checkinId");
  if (!checkinId) {
    return NextResponse.json({ success: false, error: "checkinId obrigatório" });
  }

  // Buscar qr_session ativa para este checkin
  const session = await db.query.qrSessions.findFirst({
    where: and(
      eq(qrSessions.checkinId, checkinId),
      isNull(qrSessions.consumedAt),
      gt(qrSessions.expiresAt, new Date()),
    ),
  });

  if (!session) {
    return NextResponse.json({ success: false, error: "Sessão expirada" });
  }

  const code = authenticator.generate(session.totpSecret);
  return NextResponse.json({ success: true, code });
}
```

---

## Bot no grupo — handler de 6 dígitos

Nenhuma mudança no bot. Ele continua: escuta mensagens no grupo, detecta 6 dígitos, valida contra sessões TOTP ativas.

```typescript
// Trecho relevante do src/lib/telegram.ts

bot.on("message:text", async (ctx) => {
  if (String(ctx.chat.id) !== process.env.TELEGRAM_GROUP_ID) return;

  const text = ctx.message.text.trim();
  if (!/^\d{6}$/.test(text)) return;

  // Buscar sessões TOTP ativas e tentar validar
  const sessions = await db.query.qrSessions.findMany({
    where: and(
      isNull(qrSessions.consumedAt),
      gt(qrSessions.expiresAt, new Date()),
    ),
  });

  let matchedSession = null;
  for (const session of sessions) {
    if (authenticator.verify({ token: text, secret: session.totpSecret })) {
      matchedSession = session;
      break;
    }
  }

  if (!matchedSession) {
    await ctx.reply("Código não encontrado ou expirado. Peça ao interno para gerar novo.");
    return;
  }

  // Marcar como consumido
  await db.update(qrSessions).set({
    consumedAt: new Date(),
  }).where(eq(qrSessions.id, matchedSession.id));

  // Atualizar checkin → VALIDATED
  await db.update(checkins).set({
    status: "VALIDATED",
    method: "TELEGRAM_CODE",
    totpValidatedAt: new Date(),
  }).where(eq(checkins.id, matchedSession.checkinId));

  // Buscar dados do interno
  const checkin = await db.query.checkins.findFirst({
    where: eq(checkins.id, matchedSession.checkinId),
    with: { assignment: { with: { base: true } } },
  });
  const intern = await db.query.users.findFirst({
    where: eq(users.id, matchedSession.internId),
  });
  const internRole = await db.query.userRoles.findFirst({
    where: and(eq(userRoles.userId, matchedSession.internId), eq(userRoles.role, "INTERN")),
    with: { faculty: true },
  });

  // Atualizar assignment → CHECKED_IN
  if (checkin?.assignmentId) {
    await db.update(assignments).set({ status: "CHECKED_IN" })
      .where(eq(assignments.id, checkin.assignmentId));
  }

  const period = checkin?.assignment?.period === "DAY" ? "Diurno" : "Noturno";
  await ctx.reply(
    `✅ Presença confirmada\n` +
    `👤 ${intern?.name || "Interno"} (${internRole?.faculty?.abbreviation || ""})\n` +
    `📍 ${checkin?.assignment?.base?.name || ""} — ${period}\n` +
    `📅 ${checkin?.assignment?.date || ""}`
  );
});
```

---

## Variável de ambiente

Adicionar ao `.env.local`, `.env.example` e GitHub Secrets:

```env
NEXT_PUBLIC_TELEGRAM_GROUP_USERNAME=TaximetrosSAMUInternos
```

---

## Dependência

```bash
npm install qrcode.react
```

---

## Checklist final para o Copilot

- [ ] QR code codifica `https://t.me/TaximetrosSAMUInternos?text=CODIGO` — NUNCA link do bot
- [ ] `NEXT_PUBLIC_TELEGRAM_GROUP_USERNAME=TaximetrosSAMUInternos` no `.env`
- [ ] Verificar geolocalização ANTES de gerar TOTP
- [ ] Se fora do raio: mostrar distância + "Continuar mesmo assim?"
- [ ] Se continuar fora do raio: registrar `geoValid=false` no banco
- [ ] Código de 6 dígitos exibido grande (font-mono, text-4xl, tracking largo)
- [ ] Timer circular com countdown de 90s
- [ ] QR code re-renderiza quando código rotaciona (novo currentCode = novo qrValue)
- [ ] Buscar novo código via GET no servidor quando step muda — NÃO gerar TOTP no client
- [ ] SSE para ouvir validação em tempo real; fallback polling a cada 5s
- [ ] Bot valida 6 dígitos no grupo e responde com nome/faculdade/base/turno
- [ ] Bot ignora mensagens que não são exatamente 6 dígitos
- [ ] Texto alternativo: "O preceptor pode digitar CODIGO direto no grupo"
- [ ] Fetches com paths relativos (basePath cuida do prefixo)
- [ ] Componente é `"use client"`
- [ ] `npm install qrcode.react`
