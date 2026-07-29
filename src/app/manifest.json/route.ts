/**
 * Manifesto PWA por instância.
 *
 * Era `public/manifest.json`, um arquivo estático com "SAMU Salvador" escrito
 * dentro. Com duas instâncias no mesmo código, um arquivo estático só consegue
 * servir uma delas — e a outra sai com o nome errado no ícone da tela inicial.
 *
 * Continua sendo servido no MESMO endereço (/taximetro/manifest.json) para não
 * invalidar quem já instalou o app na tela inicial.
 */

import { NextResponse } from "next/server";
import { ORG_NAME_SHORT, ORG_ICONS } from "@/lib/branding";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    {
      name: `Taxímetro Digital — ${ORG_NAME_SHORT}`,
      short_name: "Taxímetro",
      description: `Controle de presença, escala e ocorrências clínicas — ${ORG_NAME_SHORT}`,
      start_url: "/taximetro/",
      scope: "/taximetro/",
      display: "standalone",
      background_color: "#F8F9FA",
      theme_color: "#1E3A5F",
      orientation: "portrait",
      icons: [
        { src: ORG_ICONS.i192, sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: ORG_ICONS.i512, sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
    },
    { headers: { "content-type": "application/manifest+json" } },
  );
}
