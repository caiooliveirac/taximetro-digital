"use client";

import { useEffect, useState } from "react";
import { MapPin, Crosshair, CheckCircle, AlertCircle, ExternalLink, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Base = {
  id: string;
  code: string;
  name: string;
  type: "USA" | "CENTRAL";
  latitude: number;
  longitude: number;
  geoFenceMeters: number;
};

export default function LeaderCalibrar() {
  const [bases, setBases] = useState<Base[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Base | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/taximetro/api/admin/bases")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setBases(json.data.filter((b: Base) => b.type !== "CENTRAL"));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function captureGPS() {
    setCapturing(true);
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: +pos.coords.latitude.toFixed(6),
          lng: +pos.coords.longitude.toFixed(6),
        });
        setCapturing(false);
      },
      () => {
        setMsg({ type: "error", text: "Falha ao capturar GPS. Verifique permissões." });
        setCapturing(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function save() {
    if (!selected || !coords) return;
    setMsg(null);
    try {
      const res = await fetch("/taximetro/api/admin/bases/calibrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseId: selected.id, latitude: coords.lat, longitude: coords.lng }),
      });
      const json = await res.json();
      if (json.success) {
        setMsg({ type: "success", text: `Coordenadas de ${selected.code} atualizadas!` });
        setBases((prev) =>
          prev.map((b) =>
            b.id === selected.id ? { ...b, latitude: coords.lat, longitude: coords.lng } : b
          )
        );
        setSelected(null);
        setCoords(null);
      } else {
        setMsg({ type: "error", text: json.error });
      }
    } catch {
      setMsg({ type: "error", text: "Erro de conexão. Tente novamente." });
    }
  }

  function mapUrl(lat: number, lng: number) {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
  }

  if (loading) return <p className="text-sm text-slate-400">Carregando...</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Calibrar Bases</h1>
        <p className="mt-1 text-sm text-slate-500">
          Vá até a base fisicamente e capture as coordenadas GPS para corrigir a geolocalização.
        </p>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
          msg.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
        }`}>
          {msg.type === "success"
            ? <CheckCircle className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            : <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.5} />}
          {msg.text}
        </div>
      )}

      {/* Selected base — calibration flow */}
      {selected && (
        <div className="rounded-xl border border-accent-200 bg-accent-50/30 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-500">Calibrando</p>
              <p className="text-lg font-semibold text-slate-900">{selected.code} — {selected.name}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setSelected(null); setCoords(null); }}>
              Cancelar
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <div>
              <p className="text-xs text-slate-400">Coordenadas atuais</p>
              <p className="mt-0.5 font-mono text-sm text-slate-500">
                {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}
              </p>
              <a
                href={mapUrl(selected.latitude, selected.longitude)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-accent-600 hover:underline"
              >
                <ExternalLink className="h-3 w-3" strokeWidth={1.5} /> Ver no mapa
              </a>
            </div>
            <div>
              <p className="text-xs text-slate-400">Novas coordenadas</p>
              {coords ? (
                <>
                  <p className="mt-0.5 font-mono text-sm font-semibold text-emerald-700">
                    {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                  </p>
                  <a
                    href={mapUrl(coords.lat, coords.lng)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" strokeWidth={1.5} /> Verificar
                  </a>
                </>
              ) : (
                <p className="mt-0.5 text-sm text-slate-400">—</p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={captureGPS} disabled={capturing} className="gap-1.5">
              <Crosshair className={`h-4 w-4 ${capturing ? "animate-pulse" : ""}`} strokeWidth={1.5} />
              {capturing ? "Capturando..." : "Capturar GPS"}
            </Button>
            {coords && (
              <Button onClick={save} className="gap-1.5">
                <CheckCircle className="h-4 w-4" strokeWidth={1.5} /> Salvar Coordenadas
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Base cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {bases.map((b) => (
          <div
            key={b.id}
            className={`rounded-xl border bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition hover:shadow-md ${
              selected?.id === b.id ? "border-accent-500 ring-1 ring-accent-500" : "border-slate-200"
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-sm font-semibold text-slate-900">{b.code}</p>
                  <Badge variant={b.type === "USA" ? "absent" : "pending"}>{{ USA: "USA", CENTRAL: "Central" }[b.type] ?? b.type}</Badge>
                </div>
                <p className="mt-0.5 text-sm text-slate-500">{b.name}</p>
              </div>
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <Radio className="h-3 w-3" strokeWidth={1.5} />
                {b.geoFenceMeters}m
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
                <span className="font-mono text-xs text-slate-500">
                  {b.latitude.toFixed(6)}, {b.longitude.toFixed(6)}
                </span>
                <a
                  href={mapUrl(b.latitude, b.longitude)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-500 hover:text-accent-700"
                  title="Abrir mapa"
                >
                  <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                </a>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setSelected(b); setCoords(null); setMsg(null); }}
                className="gap-1 text-xs"
              >
                <Crosshair className="h-3 w-3" strokeWidth={1.5} /> Calibrar
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
