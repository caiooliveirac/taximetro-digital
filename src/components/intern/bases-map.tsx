"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { CalendarClock, LocateFixed, Loader2, MapPin, Navigation } from "lucide-react";
import { NavigationLinks } from "@/components/navigation-links";
import { getBaseStyle, type BaseType } from "@/lib/base-colors";
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
const CENTRO_SALVADOR: [number, number] = [-12.95, -38.45];

const COR: Record<BaseType, string> = { USA: "#ef4444", CENTRAL: "#0ea5e9", CRL: "#14b8a6" };
const TIPO_LABEL: Record<BaseType, string> = { USA: "USA", CENTRAL: "Central", CRL: "CRL" };

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

function rotulo(ponto: Ponto) {
  const [primeira, ...resto] = ponto.bases;
  return resto.length ? `${primeira.code} +${resto.length}` : primeira.code;
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
  const cor = COR[ponto.bases[0].type] ?? COR.USA;
  const anel = proximo ? "box-shadow:0 0 0 3px #fff,0 0 0 6px #f59e0b;" : "box-shadow:0 1px 4px rgba(0,0,0,.35);";
  // Ícone de tamanho zero no ponto; o rótulo se centraliza sobre ele, seja qual for a largura.
  const transformar = `transform:translate(-50%,-50%)${ativo ? " scale(1.15)" : ""};`;
  return `<div style="position:absolute;left:0;top:0;${transformar}display:inline-flex;align-items:center;white-space:nowrap;border-radius:999px;padding:3px 8px;font:600 11px/1.2 system-ui,sans-serif;color:#fff;background:${cor};border:2px solid #fff;cursor:pointer;${anel}">${rotulo(ponto)}</div>`;
}

export function BasesMap({ bases }: { bases: MapBase[] }) {
  const pontos = useMemo(() => agrupar(bases), [bases]);
  const mapaEl = useRef<HTMLDivElement>(null);
  const mapa = useRef<LeafletMap | null>(null);
  const marcadores = useRef(new Map<string, LeafletMarker>());
  const eu = useRef<LeafletMarker | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);

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

  // Mapa: Leaflet só existe no navegador, então entra por import dinâmico.
  useEffect(() => {
    let cancelado = false;
    const doMapa = marcadores.current;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelado || !mapaEl.current || mapa.current) return;
      leaflet.current = L;
      const m = L.map(mapaEl.current, { zoomControl: false, attributionControl: true }).setView(CENTRO_SALVADOR, 11);
      L.control.zoom({ position: "topright" }).addTo(m);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        subdomains: "abcd",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      }).addTo(m);
      for (const p of pontos) {
        const marcador = L.marker([p.latitude, p.longitude], {
          icon: L.divIcon({ className: "", html: iconeHtml(p, false, false), iconSize: [0, 0] }),
          title: p.bases.map((b) => `${b.code} — ${b.name}`).join("\n"),
          riseOnHover: true,
        }).addTo(m);
        marcador.on("click", () => setSelecionado(p.key));
        doMapa.set(p.key, marcador);
      }
      if (pontos.length) m.fitBounds(L.latLngBounds(pontos.map((p) => [p.latitude, p.longitude])), { padding: [28, 28] });
      mapa.current = m;
      // Vindo de outra tela (cartão da Luna, por exemplo): ?base=CB02 já abre nela.
      const pedida = new URLSearchParams(window.location.search).get("base");
      const alvo = pedida ? pontos.find((p) => p.bases.some((b) => b.code === pedida)) : null;
      if (alvo) {
        setSelecionado(alvo.key);
        m.setView([alvo.latitude, alvo.longitude], 15);
      }
    })();
    return () => {
      cancelado = true;
      mapa.current?.remove();
      mapa.current = null;
      doMapa.clear();
      eu.current = null;
    };
  }, [pontos]);

  // Destaque visual: selecionado cresce, base do próximo plantão ganha anel âmbar.
  useEffect(() => {
    const L = leaflet.current;
    if (!L) return;
    for (const p of pontos) {
      const marcador = marcadores.current.get(p.key);
      marcador?.setIcon(
        L.divIcon({ className: "", html: iconeHtml(p, p.key === aberto, p.key === pontoDoProximo?.key), iconSize: [0, 0] }),
      );
      marcador?.setZIndexOffset(p.key === aberto ? 1000 : p.key === pontoDoProximo?.key ? 500 : 0);
    }
  }, [pontos, aberto, pontoDoProximo]);

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
    mapa.current?.flyTo([p.latitude, p.longitude], Math.max(mapa.current.getZoom(), 14), { duration: 0.6 });
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
        const L = leaflet.current;
        const m = mapa.current;
        if (!L || !m) return;
        const icone = L.divIcon({
          className: "",
          html: '<div style="width:16px;height:16px;border-radius:999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)"></div>',
          iconAnchor: [8, 8],
        });
        if (eu.current) eu.current.setLatLng([aqui.latitude, aqui.longitude]);
        else eu.current = L.marker([aqui.latitude, aqui.longitude], { icon: icone, zIndexOffset: 2000, title: "Você está aqui" }).addTo(m);
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
          m.fitBounds(L.latLngBounds([[aqui.latitude, aqui.longitude], [alvo.latitude, alvo.longitude]]), { padding: [48, 48], maxZoom: 15 });
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
              {proximo.baseCode} · {quandoTexto(proximo)}
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
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", getBaseStyle(b.type).pill)}>{b.code}</span>
                <span className="truncate text-sm text-slate-700">{b.name}</span>
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
            label={ponto.bases.map((b) => b.code).join("/")}
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
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COR[p.bases[0].type] }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">
                    {p.bases.map((b) => b.code).join(" · ")}
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
