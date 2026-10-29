/// <reference types="google.maps" />
/**
 * Motor do mapa das bases: Google Maps quando o servidor tem
 * GOOGLE_MAPS_BROWSER_KEY, Leaflet/CARTO quando não tem (Vitalmed, dev) ou
 * quando o Google falha. A tela só conversa com esta interface.
 *
 * A chave é de navegador, restrita por referrer a mnrs.com.br no console do
 * Google — é a mesma da aba Destino da tabela.
 */

type LatLng = [number, number];

export type MotorMapa = {
  /** Marcador em HTML, ancorado pelo centro no ponto. */
  marcar(key: string, ponto: LatLng, html: string, title: string, onClick: () => void): void;
  pintar(key: string, html: string, zIndex: number): void;
  enquadrar(pontos: LatLng[], padding: number, maxZoom?: number): void;
  centrar(ponto: LatLng, zoom: number): void;
  /** Vai até o ponto sem afastar quem já estava mais perto que zoomMinimo. */
  voar(ponto: LatLng, zoomMinimo: number): void;
  marcarEu(ponto: LatLng): void;
  destruir(): void;
};

const CENTRO_SALVADOR: LatLng = [-12.95, -38.45];
const EU_HTML =
  '<div style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);width:16px;height:16px;border-radius:999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)"></div>';

async function motorLeaflet(el: HTMLElement, cancelado: () => boolean): Promise<MotorMapa | null> {
  const L = (await import("leaflet")).default;
  if (cancelado()) return null;
  const m = L.map(el, { zoomControl: false, attributionControl: true }).setView(CENTRO_SALVADOR, 11);
  L.control.zoom({ position: "topright" }).addTo(m);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    subdomains: "abcd",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(m);
  const marcadores = new Map<string, import("leaflet").Marker>();
  const icone = (html: string) => L.divIcon({ className: "", html, iconSize: [0, 0] });
  let eu: import("leaflet").Marker | null = null;

  return {
    marcar(key, ponto, html, title, onClick) {
      const marcador = L.marker(ponto, { icon: icone(html), title, riseOnHover: true }).addTo(m);
      marcador.on("click", onClick);
      marcadores.set(key, marcador);
    },
    pintar(key, html, zIndex) {
      marcadores.get(key)?.setIcon(icone(html)).setZIndexOffset(zIndex);
    },
    enquadrar(pontos, padding, maxZoom) {
      m.fitBounds(L.latLngBounds(pontos), { padding: [padding, padding], maxZoom });
    },
    centrar(ponto, zoom) {
      m.setView(ponto, zoom);
    },
    voar(ponto, zoomMinimo) {
      m.flyTo(ponto, Math.max(m.getZoom(), zoomMinimo), { duration: 0.6 });
    },
    marcarEu(ponto) {
      if (eu) eu.setLatLng(ponto);
      else eu = L.marker(ponto, { icon: icone(EU_HTML), zIndexOffset: 2000, title: "Você está aqui" }).addTo(m);
    },
    destruir() {
      m.remove();
    },
  };
}

// O script do Google só pode entrar uma vez por página.
let carregandoGoogle: Promise<void> | null = null;

function carregarGoogle(key: string, aoFalharChave: () => void): Promise<void> {
  // Chave recusada (referrer, cota) não derruba o script: o Google chama isto.
  (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = aoFalharChave;
  if (carregandoGoogle) return carregandoGoogle;
  carregandoGoogle = new Promise((resolve, reject) => {
    const cb = "__taximetroGoogleMapsPronto";
    (window as unknown as Record<string, unknown>)[cb] = () => resolve();
    const s = document.createElement("script");
    const params = new URLSearchParams({ key, v: "weekly", loading: "async", language: "pt-BR", region: "BR", callback: cb });
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onerror = () => {
      carregandoGoogle = null;
      reject(new Error("Google Maps não carregou"));
    };
    document.head.append(s);
  });
  return carregandoGoogle;
}

/** Conteúdo de tamanho zero no ponto; o HTML se centraliza sobre ele, como no divIcon do Leaflet. */
function conteudo(html: string) {
  const div = document.createElement("div");
  div.style.cssText = "position:relative;width:0;height:0";
  div.innerHTML = html;
  return div;
}

async function motorGoogle(
  el: HTMLElement,
  key: string,
  aoFalharChave: () => void,
  cancelado: () => boolean,
): Promise<MotorMapa | null> {
  await carregarGoogle(key, aoFalharChave);
  const { Map: MapaGoogle } = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
  const { AdvancedMarkerElement } = (await google.maps.importLibrary("marker")) as google.maps.MarkerLibrary;
  if (cancelado()) return null;
  const m = new MapaGoogle(el, {
    center: { lat: CENTRO_SALVADOR[0], lng: CENTRO_SALVADOR[1] },
    zoom: 11,
    // Marcador em HTML (AdvancedMarker) exige mapId; o de demonstração basta.
    mapId: "DEMO_MAP_ID",
    clickableIcons: false,
    gestureHandling: "greedy",
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_TOP },
  });
  const marcadores = new Map<string, google.maps.marker.AdvancedMarkerElement>();
  const cliques = new Map<string, () => void>();
  let eu: google.maps.marker.AdvancedMarkerElement | null = null;
  const posicao = ([lat, lng]: LatLng) => ({ lat, lng });
  const comClique = (key: string, html: string) => {
    const div = conteudo(html);
    div.addEventListener("click", () => cliques.get(key)?.());
    return div;
  };

  return {
    marcar(key, ponto, html, title, onClick) {
      cliques.set(key, onClick);
      marcadores.set(key, new AdvancedMarkerElement({ map: m, position: posicao(ponto), title, content: comClique(key, html) }));
    },
    pintar(key, html, zIndex) {
      const marcador = marcadores.get(key);
      if (!marcador) return;
      marcador.content = comClique(key, html);
      marcador.zIndex = zIndex;
    },
    enquadrar(pontos, padding, maxZoom) {
      const limites = new google.maps.LatLngBounds();
      for (const p of pontos) limites.extend(posicao(p));
      m.fitBounds(limites, padding);
      if (maxZoom !== undefined) {
        google.maps.event.addListenerOnce(m, "idle", () => {
          if ((m.getZoom() ?? 0) > maxZoom) m.setZoom(maxZoom);
        });
      }
    },
    centrar(ponto, zoom) {
      m.setCenter(posicao(ponto));
      m.setZoom(zoom);
    },
    voar(ponto, zoomMinimo) {
      m.panTo(posicao(ponto));
      if ((m.getZoom() ?? 0) < zoomMinimo) m.setZoom(zoomMinimo);
    },
    marcarEu(ponto) {
      if (eu) eu.position = posicao(ponto);
      else eu = new AdvancedMarkerElement({ map: m, position: posicao(ponto), title: "Você está aqui", content: conteudo(EU_HTML), zIndex: 2000 });
    },
    destruir() {
      for (const marcador of marcadores.values()) marcador.map = null;
      if (eu) eu.map = null;
      el.replaceChildren();
    },
  };
}

/**
 * Google se houver chave e ele subir; senão, Leaflet. null quando a tela
 * desmontou no meio do carregamento — nada foi criado no elemento.
 */
export async function criarMotor(
  el: HTMLElement,
  mapsKey: string | null,
  aoFalharChave: () => void,
  cancelado: () => boolean,
): Promise<MotorMapa | null> {
  if (mapsKey) {
    try {
      return await motorGoogle(el, mapsKey, aoFalharChave, cancelado);
    } catch (e) {
      console.error("[bases] Google Maps indisponível, usando Leaflet:", e);
      el.replaceChildren();
    }
  }
  return motorLeaflet(el, cancelado);
}
