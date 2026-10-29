"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, LocateFixed, Loader2, MapPin, Navigation } from "lucide-react";
import { criarMotor, type MotorMapa } from "@/components/intern/bases-map-motor";
import { NavigationLinks } from "@/components/navigation-links";
import type { BaseType } from "@/lib/base-colors";
import { haversineDistance } from "@/lib/geo";
import { cn, getShiftShortLabel, localDateStr } from "@/lib/utils";

export type MapBase = {
  id: string;
  code: string;
  name: string;
  type: BaseType;
  latitude: number;
  longitude: number;
};

/** Bases no mesmo endereço (BR05/BR60, PM04/PM40/CRU…) viram um ponto só no mapa. */
type Ponto = { key: string; latitude: number; longitude: number; bases: MapBase[] };

type Proximo = { baseCode: string; date: string; period: string; shift?: string | null };

const MESMO_LUGAR_METROS = 80;

/** Código interno de base que não diz nada ao interno vira o nome que ele reconhece. */
const CODIGO_NO_MAPA: Record<string, string> = { FACULDADE: "ZARNS/FACS" };
const nomeNoMapa = (code: string) => CODIGO_NO_MAPA[code] ?? code;

// Tons fortes e bem separados: o azul e o verde-azulado de antes sumiam na água e nos
// parques do mapa do Google, e CRU e CRL ficavam com cara de mesma coisa.
const COR: Record<BaseType, string> = { USA: "#dc2626", CENTRAL: "#0369a1", CRL: "#7c3aed" };
const TIPO_LABEL: Record<BaseType, string> = { USA: "USA", CENTRAL: "Central/CRU", CRL: "CRL (leitos)" };
const ORDEM_TIPO: BaseType[] = ["USA", "CENTRAL", "CRL"];

function agrupar(bases: MapBase[]): Ponto[] {
  const pontos: Ponto[] = [];
  for (const base of bases) {
    const perto = pontos.find(
      (p) => haversineDistance(p.latitude, p.longitude, base.latitude, base.longitude) <= MESMO_LUGAR_METROS,
    );
    if (perto) perto.bases.push(base);
    else pontos.push({ key: base.id, latitude: base.latitude, longitude: base.longitude, bases: [base] });
  }
  return pontos;
}

/** Bases do ponto por tipo: Pau Miúdo vira PM04/PM40 (USA) · CRU (Central) · CRL. */
function porTipo(ponto: Ponto) {
  return ORDEM_TIPO.map((type) => ({
    type,
    codes: ponto.bases.filter((b) => b.type === type).map((b) => nomeNoMapa(b.code)),
  })).filter((g) => g.codes.length);
}

function distanciaTexto(metros: number) {
  if (metros < 1000) return `${Math.round(metros / 10) * 10} m`;
  return `${(metros / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}

function quandoTexto(p: Proximo) {
  const hoje = localDateStr();
  const amanha = localDateStr(new Date(Date.now() + 86_400_000));
  const dia =
    p.date === hoje
      ? "hoje"
      : p.date === amanha
        ? "amanhã"
        : new Date(`${p.date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const turno = getShiftShortLabel(p.shift) || (p.period === "NIGHT" ? "Noturno" : "Diurno");
  return `${dia} · ${turno}`;
}

function iconeHtml(ponto: Ponto, ativo: boolean, proximo: boolean) {
  // Um pedaço por tipo, na cor dele: a CRU e a CRL não somem atrás da USA do mesmo endereço.
  const pedacos = porTipo(ponto)
    .map(
      (g, i) =>
        `<span style="padding:3px 7px;background:${COR[g.type]};${i ? "border-left:1px solid rgba(255,255,255,.7);" : ""}">${g.codes.join("/")}</span>`,
    )
    .join("");
  const anel = proximo ? "box-shadow:0 0 0 3px #fff,0 0 0 6px #f59e0b;" : "box-shadow:0 1px 4px rgba(0,0,0,.35);";
  // Ícone de tamanho zero no ponto; o rótulo se centraliza sobre ele, seja qual for a largura.
  const transformar = `transform:translate(-50%,-50%)${ativo ? " scale(1.15)" : ""};`;
  return `<div style="position:absolute;left:0;top:0;${transformar}display:inline-flex;align-items:stretch;overflow:hidden;white-space:nowrap;border-radius:999px;font:600 11px/1.2 system-ui,sans-serif;color:#fff;border:2px solid #fff;cursor:pointer;${anel}">${pedacos}</div>`;
}

export function BasesMap({ bases, mapsKey }: { bases: MapBase[]; mapsKey: string | null }) {
  const pontos = useMemo(() => agrupar(bases), [bases]);
  const mapaEl = useRef<HTMLDivElement>(null);
  const mapa = useRef<MotorMapa | null>(null);
  const [mapaPronto, setMapaPronto] = useState(false);
  // Google recusou a chave depois de carregar: refaz o mapa no Leaflet.
  const [semGoogle, setSemGoogle] = useState(false);

  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [posicao, setPosicao] = useState<{ latitude: number; longitude: number } | null>(null);
  const [localizando, setLocalizando] = useState(false);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [proximo, setProximo] = useState<Proximo | null>(null);

  const pontoDoProximo = useMemo(
    () => (proximo ? pontos.find((p) => p.bases.some((b) => b.code === proximo.baseCode)) ?? null : null),
    [pontos, proximo],
  );

  const distancias = useMemo(() => {
    const m = new Map<string, number>();
    if (!posicao) return m;
    for (const p of pontos) m.set(p.key, haversineDistance(posicao.latitude, posicao.longitude, p.latitude, p.longitude));
    return m;
  }, [pontos, posicao]);

  const lista = useMemo(() => {
    if (!posicao) return pontos;
    return [...pontos].sort((a, b) => (distancias.get(a.key) ?? 0) - (distancias.get(b.key) ?? 0));
  }, [pontos, posicao, distancias]);

  // Sem escolha do interno, a base do próximo plantão já vem aberta.
  const aberto = selecionado ?? pontoDoProximo?.key ?? null;
  const ponto = pontos.find((p) => p.key === aberto) ?? null;

  // Mapa: Google e Leaflet só existem no navegador, então entram por import/script dinâmico.
  useEffect(() => {
    let cancelado = false;
    let motor: MotorMapa | null = null;
    (async () => {
      if (!mapaEl.current) return;
      motor = await criarMotor(mapaEl.current, semGoogle ? null : mapsKey, () => setSemGoogle(true), () => cancelado);
      if (!motor) return;
      for (const p of pontos) {
        motor.marcar(
          p.key,
          [p.latitude, p.longitude],
          iconeHtml(p, false, false),
          p.bases.map((b) => `${nomeNoMapa(b.code)} — ${b.name}`).join("\n"),
          () => setSelecionado(p.key),
        );
      }
      if (pontos.length) motor.enquadrar(pontos.map((p) => [p.latitude, p.longitude]), 28);
      mapa.current = motor;
      setMapaPronto(true);
      // Vindo de outra tela (cartão da Luna, por exemplo): ?base=CB02 já abre nela.
      const pedida = new URLSearchParams(window.location.search).get("base");
      const alvo = pedida ? pontos.find((p) => p.bases.some((b) => b.code === pedida)) : null;
      if (alvo) {
        setSelecionado(alvo.key);
        motor.centrar([alvo.latitude, alvo.longitude], 15);
      }
    })();
    return () => {
      cancelado = true;
      motor?.destruir();
      mapa.current = null;
      setMapaPronto(false);
    };
  }, [pontos, mapsKey, semGoogle]);

  // Destaque visual: selecionado cresce, base do próximo plantão ganha anel âmbar.
  useEffect(() => {
    const m = mapa.current;
    if (!mapaPronto || !m) return;
    for (const p of pontos) {
      m.pintar(
        p.key,
        iconeHtml(p, p.key === aberto, p.key === pontoDoProximo?.key),
        p.key === aberto ? 1000 : p.key === pontoDoProximo?.key ? 500 : 0,
      );
    }
  }, [pontos, aberto, pontoDoProximo, mapaPronto]);

  // Próximo plantão do interno (mesma fonte da tela Hoje).
  useEffect(() => {
    const hoje = localDateStr();
    fetch(`/taximetro/api/assignments?from=${hoje}&selfOnly=true`)
      .then((r) => r.json())
      .then((json: { success?: boolean; data?: (Proximo & { status: string })[] }) => {
        if (!json.success || !json.data) return;
        const ordem = (a: Proximo) => `${a.date}|${a.period === "DAY" ? 0 : 1}|${a.shift === "AFTERNOON" ? 1 : 0}`;
        const futuro = json.data
          .filter((a) => ["SCHEDULED", "CONFIRMED", "CHECKED_IN"].includes(a.status) && a.date >= hoje)
          .sort((a, b) => ordem(a).localeCompare(ordem(b)))[0];
        if (futuro) setProximo(futuro);
      })
      .catch(() => {});
  }, []);

  const mostrar = useCallback((p: Ponto) => {
    setSelecionado(p.key);
    mapa.current?.voar([p.latitude, p.longitude], 14);
    mapaEl.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const localizar = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setErroLocal("Este navegador não informa a localização.");
      return;
    }
    setLocalizando(true);
    setErroLocal(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocalizando(false);
        const aqui = { latitude: coords.latitude, longitude: coords.longitude };
        setPosicao(aqui);
        const m = mapa.current;
        if (!m) return;
        m.marcarEu([aqui.latitude, aqui.longitude]);
        // Enquadra você e a base que importa: a do próximo plantão, ou a mais perto.
        const alvo =
          pontoDoProximo ??
          [...pontos].sort(
            (a, b) =>
              haversineDistance(aqui.latitude, aqui.longitude, a.latitude, a.longitude) -
              haversineDistance(aqui.latitude, aqui.longitude, b.latitude, b.longitude),
          )[0];
        if (alvo) {
          setSelecionado((atual) => atual ?? alvo.key);
          m.enquadrar([[aqui.latitude, aqui.longitude], [alvo.latitude, alvo.longitude]], 48, 15);
        }
      },
      (erro) => {
        setLocalizando(false);
        setErroLocal(
          erro.code === erro.PERMISSION_DENIED
            ? "Localização bloqueada. Libere nas configurações do navegador para ver a distância e traçar a rota daqui."
            : "Não consegui pegar sua localização agora. Tente de novo em um lugar aberto.",
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }, [pontos, pontoDoProximo]);

  // Quem já liberou a localização (no check-in, por exemplo) não precisa tocar no botão.
  useEffect(() => {
    navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((s) => {
        if (s.state === "granted") localizar();
      })
      .catch(() => {});
    // Só na abertura da tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      {proximo && pontoDoProximo ? (
        <button
          type="button"
          onClick={() => mostrar(pontoDoProximo)}
          className="flex w-full items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left transition active:scale-[0.99]"
        >
          <CalendarClock className="h-5 w-5 shrink-0 text-amber-600" strokeWidth={1.8} />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-amber-700">Seu próximo plantão</span>
            <span className="block truncate text-sm font-semibold text-slate-900">
              {nomeNoMapa(proximo.baseCode)} · {quandoTexto(proximo)}
            </span>
          </span>
          <span className="text-xs font-semibold text-amber-700">Ver rota</span>
        </button>
      ) : null}

      <div className="relative isolate overflow-hidden rounded-2xl border border-slate-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div ref={mapaEl} className="h-[52vh] min-h-[300px] w-full bg-slate-100" aria-label="Mapa das bases em Salvador" />
        <button
          type="button"
          onClick={localizar}
          disabled={localizando}
          className="absolute bottom-3 right-3 z-[500] inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-md ring-1 ring-slate-200 transition active:scale-95 disabled:opacity-70"
        >
          {localizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4 text-blue-600" />}
          {posicao ? "Atualizar" : "Onde estou"}
        </button>
        <div className="pointer-events-none absolute left-3 top-3 z-[500] flex gap-1.5">
          {(Object.keys(COR) as BaseType[]).map((tipo) => (
            <span key={tipo} className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-700 shadow-sm">
              <span className="h-2 w-2 rounded-full" style={{ background: COR[tipo] }} />
              {TIPO_LABEL[tipo]}
            </span>
          ))}
        </div>
      </div>

      {erroLocal ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{erroLocal}</p>
      ) : null}

      {ponto ? (
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="space-y-1.5">
            {ponto.bases.map((b) => (
              <div key={b.id} className="flex items-center gap-2">
                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: COR[b.type] }}>
                  {nomeNoMapa(b.code)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{b.name}</span>
                <span className="shrink-0 text-[11px] font-medium text-slate-400">{TIPO_LABEL[b.type]}</span>
              </div>
            ))}
            {distancias.has(ponto.key) ? (
              <p className="flex items-center gap-1 text-xs text-slate-500">
                <Navigation className="h-3.5 w-3.5" />
                {distanciaTexto(distancias.get(ponto.key)!)} de você, em linha reta
              </p>
            ) : null}
          </div>
          <NavigationLinks
            latitude={ponto.latitude}
            longitude={ponto.longitude}
            label={ponto.bases.map((b) => nomeNoMapa(b.code)).join("/")}
            origin={posicao}
            title={posicao ? "Rota saindo de onde você está" : "Como chegar"}
          />
        </section>
      ) : (
        <p className="flex items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-500">
          <MapPin className="h-4 w-4 shrink-0" /> Toque numa base no mapa para abrir a rota no Maps, Waze ou Uber.
        </p>
      )}

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {posicao ? "Mais perto de você" : "Todas as bases"}
        </h2>
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {lista.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                onClick={() => mostrar(p)}
                className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50", p.key === aberto && "bg-slate-50")}
              >
                <span className="flex shrink-0 -space-x-1">
                  {porTipo(p).map((g) => (
                    <span key={g.type} className="h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: COR[g.type] }} />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">
                    {p.bases.map((b) => nomeNoMapa(b.code)).join(" · ")}
                    {p.key === pontoDoProximo?.key ? (
                      <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">próximo plantão</span>
                    ) : null}
                  </span>
                  <span className="block truncate text-xs text-slate-500">{p.bases.map((b) => b.name).join(" · ")}</span>
                </span>
                {distancias.has(p.key) ? (
                  <span className="shrink-0 text-xs font-medium text-slate-500">{distanciaTexto(distancias.get(p.key)!)}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
