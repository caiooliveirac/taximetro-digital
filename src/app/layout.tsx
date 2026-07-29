import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Providers from "@/app/providers";
import "@/app/globals.css";
import { ORG_NAME, ORG_NAME_SHORT, ORG_BASE_URL, ORG_OG_IMAGE, ORG_ICONS } from "@/lib/branding";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const TITULO = `Taxímetro Digital — ${ORG_NAME_SHORT}`;
const DESCRICAO = "Tecnologia e eficiência no registro de presença. Conectando dados, salvando vidas.";

export const metadata: Metadata = {
  title: TITULO,
  description: `Tecnologia e eficiência no registro de presença — ${ORG_NAME}`,
  metadataBase: new URL(ORG_BASE_URL),
  openGraph: {
    title: TITULO,
    description: DESCRICAO,
    url: `${ORG_BASE_URL}/taximetro`,
    siteName: `Taxímetro ${ORG_NAME_SHORT}`,
    images: [
      {
        url: ORG_OG_IMAGE.url,
        width: ORG_OG_IMAGE.width,
        height: ORG_OG_IMAGE.height,
        alt: `Taxímetro ${ORG_NAME_SHORT} — Registro de presença digital`,
      },
    ],
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITULO,
    description: DESCRICAO,
    images: [ORG_OG_IMAGE.url],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1E3A5F",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="manifest" href="/taximetro/manifest.json" />
        <link rel="icon" href={ORG_ICONS.i192} />
        <link rel="apple-touch-icon" href={ORG_ICONS.i192} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans bg-background text-slate-900 antialiased min-h-screen`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
