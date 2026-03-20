"use client";

import { useEffect, useState } from "react";
import { Plus, MapPin, ExternalLink, Crosshair, Save, X, AlertCircle, Ambulance, Building2, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input as UIInput } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { baseViewIndex } from "@/lib/base-colors";

type Base = {
  id: string;
  code: string;
  name: string;
  type: "USA" | "CENTRAL";
  latitude: number;
  longitude: number;
  geoFenceMeters: number;
  isActive: boolean;
};

const EMPTY: Omit<Base, "id"> = { code: "", name: "", type: "USA", latitude: 0, longitude: 0, geoFenceMeters: 200, isActive: true };

const TYPE_CONFIG: Record<string, { label: string; icon: typeof Ambulance; variant: "absent" | "scheduled" | "pending" }> = {
  USA: { label: "USA", icon: Ambulance, variant: "absent" },
  CENTRAL: { label: "Central", icon: Building2, variant: "pending" },
};

export default function AdminBases() {
  const [bases, setBases] = useState<Base[]>([]);
  const [editing, setEditing] = useState<Partial<Base> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);

  async function load() {
    try {
      const res = await fetch("/taximetro/api/admin/bases");
      const json = await res.json();
      if (json.success) setBases(json.data);
    } catch {
      setError("Erro ao carregar bases.");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setError("");
    if (!editing) return;
    try {
      const isNew = !editing.id;
      const res = await fetch("/taximetro/api/admin/bases", {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      const json = await res.json();
      if (!json.success) { setError(json.error); return; }
      setEditing(null);
      load();
    } catch {
      setError("Erro de conexão. Tente novamente.");
    }
  }

  function captureGPS() {
    if (!editing) return;
    setCapturing(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setEditing({
          ...editing,
          latitude: +pos.coords.latitude.toFixed(6),
          longitude: +pos.coords.longitude.toFixed(6),
        });
        setCapturing(false);
      },
      () => {
        setError("Não foi possível obter localização. Verifique permissões do navegador.");
        setCapturing(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function mapUrl(lat: number, lng: number) {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
  }

  if (loading) return <p className="text-sm text-slate-400">Carregando...</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Bases SAMU</h1>
        <Button onClick={() => setEditing({ ...EMPTY })} className="gap-1.5">
          <Plus className="h-4 w-4" strokeWidth={1.5} /> Nova Base
        </Button>
      </div>

      {/* Edit / Create Form */}
      {editing && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] space-y-4">
          <h2 className="font-semibold text-slate-900">{editing.id ? "Editar Base" : "Nova Base"}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Código</span>
              <UIInput value={editing.code ?? ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} className="mt-1" placeholder="SM01" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Nome</span>
              <UIInput value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="mt-1" placeholder="São Marcos" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Tipo</span>
              <select
                value={editing.type ?? "USA"}
                onChange={(e) => setEditing({ ...editing, type: e.target.value as Base["type"] })}
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
              >
                <option value="USA">USA</option>
                <option value="CENTRAL">Central</option>
              </select>
            </label>
          </div>

          {/* Coordinates section */}
          <div className="rounded-lg border border-slate-200 bg-background p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                <MapPin className="h-4 w-4 text-accent-500" strokeWidth={1.5} />
                Coordenadas
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={captureGPS}
                disabled={capturing}
                className="gap-1.5 text-xs"
              >
                <Crosshair className={`h-3.5 w-3.5 ${capturing ? "animate-pulse" : ""}`} strokeWidth={1.5} />
                {capturing ? "Capturando..." : "Capturar GPS"}
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-500">Latitude</span>
                <UIInput
                  type="number"
                  step="0.000001"
                  value={String(editing.latitude ?? 0)}
                  onChange={(e) => setEditing({ ...editing, latitude: +e.target.value })}
                  className="mt-1 font-mono text-xs"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-500">Longitude</span>
                <UIInput
                  type="number"
                  step="0.000001"
                  value={String(editing.longitude ?? 0)}
                  onChange={(e) => setEditing({ ...editing, longitude: +e.target.value })}
                  className="mt-1 font-mono text-xs"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-500">Raio geofence (m)</span>
                <UIInput
                  type="number"
                  value={String(editing.geoFenceMeters ?? 200)}
                  onChange={(e) => setEditing({ ...editing, geoFenceMeters: +e.target.value })}
                  className="mt-1"
                />
              </label>
            </div>
            {(editing.latitude !== 0 || editing.longitude !== 0) && (
              <a
                href={mapUrl(editing.latitude ?? 0, editing.longitude ?? 0)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent-600 hover:text-accent-700 hover:underline"
              >
                <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                Verificar no mapa
              </a>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.5} /> {error}
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={save} className="gap-1.5">
              <Save className="h-4 w-4" strokeWidth={1.5} /> Salvar
            </Button>
            <Button variant="outline" onClick={() => { setEditing(null); setError(""); }}>
              <X className="h-4 w-4" strokeWidth={1.5} /> Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Coordenadas</TableHead>
              <TableHead>Raio</TableHead>
              <TableHead className="w-[1%]">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bases
              .filter(b => b.type === "USA")
              .sort((a, b) => baseViewIndex(a.code) - baseViewIndex(b.code))
              .map((b) => {
                const cfg = TYPE_CONFIG[b.type];
                const hasCoords = b.latitude !== 0 || b.longitude !== 0;
                const coordsLook = b.latitude === 0 && b.longitude === 0;
                return (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono font-medium text-slate-900">{b.code}</TableCell>
                    <TableCell className="text-slate-900">{b.name}</TableCell>
                    <TableCell><Badge variant={cfg.variant}>{cfg.label}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-xs ${coordsLook ? "text-red-500" : "text-slate-500"}`}>
                          {b.latitude.toFixed(6)}, {b.longitude.toFixed(6)}
                        </span>
                        {hasCoords && (
                          <a
                            href={mapUrl(b.latitude, b.longitude)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-500 hover:text-accent-700"
                            title="Ver no mapa"
                          >
                            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-500">{b.geoFenceMeters}m</TableCell>
                    <TableCell>
                      <button
                        onClick={() => setEditing(b)}
                        className="text-sm font-medium text-accent-600 hover:text-accent-700 hover:underline"
                      >
                        Editar
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>

      {/* CRU — Central de Regulação */}
      {bases.filter(b => b.type === "CENTRAL").length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-900 mb-2">Central de Regulação</h2>
          <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Coordenadas</TableHead>
                  <TableHead>Raio</TableHead>
                  <TableHead className="w-[1%]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bases.filter(b => b.type === "CENTRAL").map((b) => {
                  const cfg = TYPE_CONFIG[b.type];
                  const hasCoords = b.latitude !== 0 || b.longitude !== 0;
                  const coordsLook = b.latitude === 0 && b.longitude === 0;
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono font-medium text-slate-900">{b.code}</TableCell>
                      <TableCell className="text-slate-900">{b.name}</TableCell>
                      <TableCell><Badge variant={cfg.variant}>{cfg.label}</Badge></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-xs ${coordsLook ? "text-red-500" : "text-slate-500"}`}>
                            {b.latitude.toFixed(6)}, {b.longitude.toFixed(6)}
                          </span>
                          {hasCoords && (
                            <a
                              href={mapUrl(b.latitude, b.longitude)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent-500 hover:text-accent-700"
                              title="Ver no mapa"
                            >
                              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-500">{b.geoFenceMeters}m</TableCell>
                      <TableCell>
                        <button
                          onClick={() => setEditing(b)}
                          className="text-sm font-medium text-accent-600 hover:text-accent-700 hover:underline"
                        >
                          Editar
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
