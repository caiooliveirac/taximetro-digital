import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Providers from "@/app/providers";
import "@/app/globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Taxímetro Digital — SAMU Salvador",
  description: "Tecnologia e eficiência no registro de presença — SAMU 192",
  metadataBase: new URL("https://mnrs.com.br"),
  openGraph: {
    title: "Taxímetro Digital — SAMU 192",
    description: "Tecnologia e eficiência no registro de presença. Conectando dados, salvando vidas.",
    url: "https://mnrs.com.br/taximetro",
    siteName: "Taxímetro SAMU",
    images: [
      {
        url: "/taximetro/icons/image.png",
        width: 1024,
        height: 559,
        alt: "Taxímetro SAMU — Registro de presença digital",
      },
    ],
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Taxímetro Digital — SAMU 192",
    description: "Tecnologia e eficiência no registro de presença. Conectando dados, salvando vidas.",
    images: ["/taximetro/icons/image.png"],
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
        <link rel="icon" href="/taximetro/icons/icon-192.png" />
        <link rel="apple-touch-icon" href="/taximetro/icons/icon-192.png" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans bg-background text-slate-900 antialiased min-h-screen`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
