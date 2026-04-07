# Instruções para o Copilot — Fluxo de Check-in com QR Code + Telegram Deep Link

> **Contexto**: O QR code gerado no check-in do interno está abrindo o navegador e sugerindo "instalar o Telegram" mesmo em celulares que já têm o app. Isso acontece porque o link `https://t.me/...` é um link HTTP que cai no site do Telegram antes de redirecionar ao app. Precisamos usar o **URI scheme nativo** do Telegram.

---

## 1. O problema atual

O QR code codifica algo como:
```
https://t.me/SAMUTaximetroBot?start=123456
```

Esse formato:
- Abre o **navegador** primeiro (Safari/Chrome)
- Mostra página "Open in Telegram" / "Instalar Telegram"
- Se o preceptor clica "Open in Telegram", abre chat **privado** com o bot
- O preceptor teria que copiar o código e colar no grupo manualmente
- **Experiência péssima**: 3+ cliques, confusão, atraso

---

## 2. A solução: URI scheme `tg://` + fluxo híbrido

### Estratégia escolhida

O QR code deve usar o **URI scheme nativo `tg://`** que abre o Telegram diretamente, sem passar pelo navegador. O fluxo funciona assim:

1. Interno toca "Check-in" → app verifica geolocalização
2. Se distante da base: **alerta com distância** + pergunta "Deseja continuar mesmo assim?"
3. Se continuar (ou se estiver dentro do raio): gera TOTP e exibe tela com QR code + código numérico
4. Preceptor aponta câmera → Telegram abre direto no chat do bot → bot valida automaticamente
5. Bot posta confirmação no grupo de preceptores

### O deep link correto

```
tg://resolve?domain=SAMUTaximetroBot&start=CODIGO_TOTP
```

**Por que `tg://resolve`?**
- Abre o Telegram **diretamente** sem passar pelo navegador
- Funciona tanto no iOS quanto no Android
- O parâmetro `start=` dispara o comando `/start CODIGO_TOTP` automaticamente no bot
- O bot recebe o código, valida, e posta a confirmação no grupo

**Fallback para quem não tem Telegram**: manter o link `https://t.me/SAMUTaximetroBot?start=CODIGO_TOTP` como fallback textual na tela (não no QR). Assim o QR é sempre o `tg://` nativo.

---

## 3. Implementação — Componente de Check-in do Interno

### 3.1 Página `src/app/intern/checkin/page.tsx`

```tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react"; // npm install qrcode.react

type CheckinState =
  | "IDLE"           // botão "Iniciar Check-in"
  | "CHECKING_GEO"   // obtendo localização
  | "GEO_WARNING"    // fora do raio, perguntando se quer continuar
  | "GENERATING"     // gerando TOTP no servidor
  | "AWAITING"       // QR code + código exibidos, aguardando preceptor
  | "VALIDATED"      // preceptor confirmou
  | "ERROR";         // algo deu errado

interface TotpData {
  checkinId: string;
  currentCode: string;
  totpSecret: string;      // NÃO exibir pro usuário — só pro timer local
  expiresAt: string;       // ISO datetime — sessão expira
  assignmentId: string;
  baseName: string;
  baseCode: string;
}

export default function CheckinPage() {
  const [state, setState] = useState<CheckinState>("IDLE");
  const [geoDistance, setGeoDistance] = useState<number | null>(null);
  const [geoFenceMeters, setGeoFenceMeters] = useState<number>(200);
  const [totpData, setTotpData] = useState<TotpData | null>(null);
  const [currentCode, setCurrentCode] = useState<string>("");
  const [countdown, setCountdown] = useState<number>(90);
  const [error, setError] = useState<string>("");
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  // ==========================================
  // PASSO 1: Obter geolocalização
  // ==========================================
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

        // Enviar coordenadas pro servidor para calcular distância
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
            // Dentro do raio — prosseguir direto
            await generateTotp(latitude, longitude);
          } else {
            // FORA do raio — alertar e perguntar
            setState("GEO_WARNING");
          }
        } catch (err) {
          setError("Erro de conexão ao verificar localização.");
          setState("ERROR");
        }
      },
      (geoError) => {
        const messages: Record<number, string> = {
          1: "Permissão de localização negada. Ative nas configurações do celular.",
          2: "Não foi possível obter sua localização. Tente novamente.",
          3: "Tempo esgotado ao obter localização. Tente em local aberto.",
        };
        setError(messages[geoError.code] || "Erro de geolocalização.");
        setState("ERROR");
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  }, []);

  // ==========================================
  // PASSO 2: Gerar TOTP no servidor
  // ==========================================
  const generateTotp = useCallback(async (lat: number, lng: number) => {
    setState("GENERATING");

    try {
      const res = await fetch("/api/attendance/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || "Erro ao gerar código de presença.");
        setState("ERROR");
        return;
      }

      setTotpData(data.data);
      setCurrentCode(data.data.currentCode);
      setCountdown(90);
      setState("AWAITING");

      // Iniciar timer de rotação do código
      startCodeRotation(data.data.totpSecret, data.data.expiresAt);

      // Iniciar SSE para ouvir validação do preceptor
      startSSE(data.data.assignmentId);

    } catch (err) {
      setError("Erro de conexão. Verifique sua internet.");
      setState("ERROR");
    }
  }, []);

  // ==========================================
  // PASSO 3: Timer TOTP (rotação a cada 90s)
  // ==========================================
  const startCodeRotation = (secret: string, expiresAt: string) => {
    if (timerRef.current) clearInterval(timerRef.current);

    const updateCode = () => {
      const now = Math.floor(Date.now() / 1000);
      const step = 90;
      const timeLeft = step - (now % step);
      setCountdown(timeLeft);

      // Verificar se sessão expirou (30 min)
      if (new Date() > new Date(expiresAt)) {
        setState("ERROR");
        setError("Sessão expirou. Inicie o check-in novamente.");
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }

      // Gerar código TOTP localmente usando o secret
      // IMPORTANTE: usar a mesma lib do servidor (otplib com step=90)
      // Em produção, buscar código atualizado do servidor a cada rotação
      // para evitar dessincronização. Alternativa mais simples:
      fetch("/api/attendance/checkin/current-code?checkinId=" + (totpData?.checkinId || ""))
        .then(r => r.json())
        .then(d => {
          if (d.success && d.code) {
            setCurrentCode(d.code);
          }
        })
        .catch(() => { /* fallback: manter código atual */ });
    };

    updateCode();
    timerRef.current = setInterval(updateCode, 1000);
  };

  // ==========================================
  // PASSO 4: SSE — ouvir validação do preceptor
  // ==========================================
  const startSSE = (assignmentId: string) => {
    if (sseRef.current) sseRef.current.close();

    const es = new EventSource(`/api/attendance/status/${assignmentId}`);

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.status === "VALIDATED") {
        setState("VALIDATED");
        cleanup();
      }
    };

    es.onerror = () => {
      // Fallback: polling a cada 5s
      es.close();
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
  };

  const cleanup = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (sseRef.current) sseRef.current.close();
  };

  useEffect(() => {
    return cleanup;
  }, []);

  // ==========================================
  // DEEP LINK DO TELEGRAM — A PARTE CRÍTICA
  // ==========================================
  const BOT_USERNAME = "SAMUTaximetroBot"; // sem @

  // URI scheme nativo — abre Telegram direto, sem navegador
  const telegramNativeLink = `tg://resolve?domain=${BOT_USERNAME}&start=${currentCode}`;

  // Fallback HTTP — só usar como texto alternativo
  const telegramHttpLink = `https://t.me/${BOT_USERNAME}?start=${currentCode}`;

  // O QR code SEMPRE usa o tg:// nativo
  const qrValue = telegramNativeLink;

  // ==========================================
  // RENDER
  // ==========================================
  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-6">

      {/* === ESTADO: IDLE === */}
      {state === "IDLE" && (
        <div className="flex flex-col items-center gap-6 mt-12">
          <h1 className="text-2xl font-bold text-center">Check-in de Presença</h1>
          <p className="text-gray-600 text-center max-w-sm">
            Toque no botão para iniciar. Será necessário permitir acesso à sua localização.
          </p>
          <button
            onClick={startCheckin}
            className="w-full max-w-xs bg-blue-600 text-white py-4 rounded-xl text-lg font-semibold
                       active:bg-blue-700 transition-colors"
          >
            Iniciar Check-in
          </button>
        </div>
      )}

      {/* === ESTADO: VERIFICANDO GEO === */}
      {state === "CHECKING_GEO" && (
        <div className="flex flex-col items-center gap-4 mt-12">
          <div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full" />
          <p className="text-gray-600">Verificando sua localização...</p>
        </div>
      )}

      {/* === ESTADO: ALERTA DE DISTÂNCIA === */}
      {state === "GEO_WARNING" && (
        <div className="flex flex-col items-center gap-6 mt-8 max-w-sm">
          <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-6 text-center">
            <p className="text-amber-800 font-bold text-lg mb-2">⚠️ Fora do raio da base</p>
            <p className="text-amber-700">
              Você está a <span className="font-bold">{geoDistance?.toFixed(0)}m</span> da base.
              O raio permitido é <span className="font-bold">{geoFenceMeters}m</span>.
            </p>
          </div>
          <p className="text-gray-600 text-center text-sm">
            Se você realmente está na base, sua localização pode estar imprecisa.
            Deseja continuar mesmo assim? O check-in ficará registrado como fora do raio.
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
                // Continuar mesmo fora do raio — servidor registra geoValid=false
                navigator.geolocation.getCurrentPosition(
                  (pos) => generateTotp(pos.coords.latitude, pos.coords.longitude),
                  () => { setError("Erro ao obter localização."); setState("ERROR"); },
                  { enableHighAccuracy: true, timeout: 10000 }
                );
              }}
              className="flex-1 bg-amber-500 text-white py-3 rounded-xl font-medium
                         active:bg-amber-600 transition-colors"
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* === ESTADO: GERANDO TOTP === */}
      {state === "GENERATING" && (
        <div className="flex flex-col items-center gap-4 mt-12">
          <div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full" />
          <p className="text-gray-600">Gerando código de presença...</p>
        </div>
      )}

      {/* === ESTADO: AGUARDANDO PRECEPTOR (QR + CÓDIGO) === */}
      {state === "AWAITING" && (
        <div className="flex flex-col items-center gap-5 mt-4 w-full max-w-sm">
          <h1 className="text-xl font-bold text-center">Aguardando preceptor</h1>

          {/* QR Code */}
          <div className="bg-white p-4 rounded-2xl shadow-lg">
            <QRCodeCanvas
              value={qrValue}
              size={220}
              level="M"
              includeMargin={true}
            />
          </div>

          <p className="text-gray-500 text-sm text-center">
            Peça ao preceptor para apontar a câmera do celular para o QR acima
          </p>

          {/* Código numérico grande */}
          <div className="bg-gray-50 rounded-xl p-6 text-center w-full">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Código de presença</p>
            <p className="text-4xl font-mono font-bold tracking-[0.3em] text-gray-900">
              {currentCode}
            </p>
          </div>

          {/* Timer countdown */}
          <div className="flex items-center gap-2">
            <div className="relative h-8 w-8">
              <svg className="h-8 w-8 -rotate-90" viewBox="0 0 36 36">
                <circle
                  cx="18" cy="18" r="16"
                  fill="none" stroke="#e5e7eb" strokeWidth="3"
                />
                <circle
                  cx="18" cy="18" r="16"
                  fill="none" stroke="#3b82f6" strokeWidth="3"
                  strokeDasharray={`${(countdown / 90) * 100.5} 100.5`}
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <span className="text-sm text-gray-600">
              Novo código em <span className="font-mono font-bold">{countdown}s</span>
            </span>
          </div>

          {/* Instrução alternativa */}
          <div className="bg-blue-50 rounded-xl p-4 text-center text-sm text-blue-800 w-full">
            <p className="font-medium mb-1">Alternativa:</p>
            <p>O preceptor pode digitar o código <span className="font-mono font-bold">{currentCode}</span> diretamente no grupo do Telegram</p>
          </div>

          {/* Link fallback — NÃO é QR, é texto clicável */}
          <details className="text-xs text-gray-400 cursor-pointer">
            <summary>QR não funcionou?</summary>
            <p className="mt-2">
              Se a câmera não abriu o Telegram, o preceptor pode{" "}
              <a
                href={telegramHttpLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 underline"
              >
                clicar aqui
              </a>{" "}
              ou digitar o código no grupo do Telegram.
            </p>
          </details>
        </div>
      )}

      {/* === ESTADO: VALIDADO === */}
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

      {/* === ESTADO: ERRO === */}
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

## 4. API Route — Verificação de geolocalização

### `src/app/api/attendance/checkin/geo-check/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/db";
import { assignments, bases } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { haversineDistance } from "@/lib/geo";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });
  }

  const { latitude, longitude } = await req.json();

  // Buscar assignment de hoje do interno
  const today = new Date().toISOString().split("T")[0];
  const currentHour = new Date().getHours();
  const period = currentHour < 19 ? "DAY" : "NIGHT"; // ajustar conforme regra real

  const assignment = await db.query.assignments.findFirst({
    where: and(
      eq(assignments.internId, session.user.id),
      eq(assignments.date, today),
      eq(assignments.period, period),
    ),
    with: { base: true },
  });

  if (!assignment) {
    return NextResponse.json({
      success: false,
      error: "Nenhum plantão encontrado para hoje.",
    });
  }

  const distance = haversineDistance(
    latitude, longitude,
    assignment.base.latitude, assignment.base.longitude
  );

  return NextResponse.json({
    success: true,
    distanceMeters: Math.round(distance),
    geoFenceMeters: assignment.base.geoFenceMeters,
    withinFence: distance <= assignment.base.geoFenceMeters,
    baseName: assignment.base.name,
    baseCode: assignment.base.code,
  });
}
```

---

## 5. Bot Telegram — Tratamento do `/start CODE`

### No `src/lib/telegram.ts`, adicionar handler:

```typescript
import { Bot } from "grammy";
import { db } from "@/db";
import { qrSessions, checkins, assignments, users, userRoles, telegramBindings } from "@/db/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import { validateTotp } from "@/lib/totp";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
const PRECEPTOR_GROUP_ID = process.env.TELEGRAM_GROUP_ID!;

// === /start CODE — quando preceptor escaneia QR ===
bot.command("start", async (ctx) => {
  // Só funciona em chat privado (o QR abre chat privado com o bot)
  if (ctx.chat.type !== "private") return;

  const code = ctx.match?.trim(); // o parâmetro após /start
  if (!code || !/^\d{6}$/.test(code)) {
    await ctx.reply("Código inválido. Use o QR code do interno ou digite o código de 6 dígitos no grupo.");
    return;
  }

  // Identificar preceptor pelo Telegram ID
  const binding = await db.query.telegramBindings.findFirst({
    where: eq(telegramBindings.telegramUserId, String(ctx.from.id)),
  });

  if (!binding) {
    await ctx.reply(
      "Seu Telegram não está vinculado ao sistema. Use /vincular SEU_CPF para se cadastrar."
    );
    return;
  }

  // Validar o código TOTP
  const result = await validateTotpCode(code, binding.userId);

  if (!result.success) {
    await ctx.reply(result.error || "Código não encontrado ou expirado.");
    return;
  }

  // Postar confirmação no GRUPO de preceptores
  await bot.api.sendMessage(
    PRECEPTOR_GROUP_ID,
    `✅ Presença confirmada:\n` +
    `👤 ${result.internName} (${result.facultyAbbr})\n` +
    `📍 ${result.baseName} — ${result.period === "DAY" ? "Diurno" : "Noturno"}\n` +
    `📅 ${result.date}\n` +
    `✔️ Validado por: ${binding.telegramName}`
  );

  // Confirmar pro preceptor no chat privado
  await ctx.reply(
    `✅ Presença de ${result.internName} confirmada com sucesso!`
  );
});

// === Mensagens no grupo — código digitado manualmente ===
bot.on("message:text", async (ctx) => {
  // Só processa no grupo de preceptores
  if (String(ctx.chat.id) !== PRECEPTOR_GROUP_ID) return;

  const text = ctx.message.text.trim();
  // Só processa se for exatamente 6 dígitos
  if (!/^\d{6}$/.test(text)) return;

  const binding = await db.query.telegramBindings.findFirst({
    where: eq(telegramBindings.telegramUserId, String(ctx.from.id)),
  });

  if (!binding) {
    await ctx.reply("Telegram não vinculado. Use /vincular SEU_CPF no chat privado com o bot.");
    return;
  }

  const result = await validateTotpCode(text, binding.userId);

  if (!result.success) {
    await ctx.reply("Código não encontrado ou expirado. Peça ao interno para gerar novo.");
    return;
  }

  await ctx.reply(
    `✅ Presença confirmada:\n` +
    `👤 ${result.internName} (${result.facultyAbbr})\n` +
    `📍 ${result.baseName} — ${result.period === "DAY" ? "Diurno" : "Noturno"}\n` +
    `📅 ${result.date}`
  );
});

// === Função compartilhada de validação ===
async function validateTotpCode(code: string, preceptorUserId: string) {
  // Buscar sessão TOTP ativa (não consumida, não expirada)
  const session = await db.query.qrSessions.findFirst({
    where: and(
      isNull(qrSessions.consumedAt),
      gt(qrSessions.expiresAt, new Date()),
    ),
  });

  if (!session) {
    return { success: false, error: "Nenhuma sessão ativa encontrada." };
  }

  // Validar código TOTP contra o secret (janela atual ± 1)
  const isValid = validateTotp(code, session.totpSecret);

  if (!isValid) {
    return { success: false, error: "Código inválido ou expirado." };
  }

  // Marcar sessão como consumida
  await db.update(qrSessions).set({
    consumedAt: new Date(),
    consumedBy: preceptorUserId,
  }).where(eq(qrSessions.id, session.id));

  // Atualizar checkin como VALIDATED
  await db.update(checkins).set({
    status: "VALIDATED",
    validatedBy: preceptorUserId,
    method: "TELEGRAM_QR", // ou TELEGRAM_CODE conforme contexto
    totpValidatedAt: new Date(),
  }).where(eq(checkins.id, session.checkinId));

  // Atualizar assignment para CHECKED_IN
  const checkin = await db.query.checkins.findFirst({
    where: eq(checkins.id, session.checkinId),
    with: {
      assignment: {
        with: { base: true },
      },
    },
  });

  if (checkin?.assignmentId) {
    await db.update(assignments).set({
      status: "CHECKED_IN",
    }).where(eq(assignments.id, checkin.assignmentId));
  }

  // Buscar dados do interno para a mensagem de confirmação
  const intern = await db.query.users.findFirst({
    where: eq(users.id, session.internId),
  });

  const internRole = await db.query.userRoles.findFirst({
    where: and(
      eq(userRoles.userId, session.internId),
      eq(userRoles.role, "INTERN"),
    ),
    with: { faculty: true },
  });

  return {
    success: true,
    internName: intern?.name || "Interno",
    facultyAbbr: internRole?.faculty?.abbreviation || "",
    baseName: checkin?.assignment?.base?.name || "",
    baseCode: checkin?.assignment?.base?.code || "",
    period: checkin?.assignment?.period || "",
    date: checkin?.assignment?.date || new Date().toISOString().split("T")[0],
  };
}

export { bot };
```

---

## 6. Resumo dos deep links e quando usar cada um

| Contexto | URL no QR Code | Comportamento |
|----------|---------------|---------------|
| **QR code na tela do interno** | `tg://resolve?domain=SAMUTaximetroBot&start=123456` | Abre Telegram direto → chat privado com bot → bot recebe `/start 123456` → valida → posta no grupo |
| **Link fallback (texto clicável)** | `https://t.me/SAMUTaximetroBot?start=123456` | Abre navegador → redirect → Telegram (mais lento, mas funciona como backup) |
| **Digitação manual** | Preceptor digita `123456` no grupo | Bot detecta 6 dígitos no grupo → valida → responde no grupo |

---

## 7. Dependência necessária

```bash
npm install qrcode.react
```

A lib `qrcode.react` gera o QR code como canvas no React. Usar `QRCodeCanvas` (não SVG) para melhor compatibilidade mobile.

---

## 8. Checklist para o Copilot

- [ ] QR code usa `tg://resolve?domain=BOT&start=CODE` (NUNCA `https://t.me/...`)
- [ ] Tela de check-in verifica geo ANTES de gerar TOTP
- [ ] Se fora do raio: mostra distância + pergunta se quer continuar
- [ ] Se continuar fora do raio: registra `geoValid=false` no banco
- [ ] Código TOTP exibido grande e legível (font-mono, tracking largo)
- [ ] Timer circular mostra countdown até próximo código (90s)
- [ ] SSE escuta validação do preceptor em tempo real
- [ ] Fallback: polling a cada 5s se SSE falhar
- [ ] Bot processa `/start CODE` no chat privado (vindo do QR)
- [ ] Bot processa 6 dígitos no grupo (digitação manual)
- [ ] Bot posta confirmação no grupo após validar
- [ ] Link `https://t.me/...` disponível como texto fallback (NÃO no QR)
- [ ] Todos os fetches usam paths relativos (sem `https://mnrs.com.br/taximetro`)
- [ ] Componente é `"use client"` (usa hooks e browser APIs)
