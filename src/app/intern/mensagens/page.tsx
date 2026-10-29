"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatBrazilTime, localDateStr } from "@/lib/utils";

type Conversa = {
  comId: string;
  nome: string;
  faculdade: string | null;
  naoLidas: number;
  ultima: { texto: string; em: string; minha: boolean };
};

type Mensagem = { id: string; texto: string; em: string; minha: boolean };

type Pessoa = { id: string; nome: string; faculdade: string | null };

const ATUALIZAR_MS = 6_000;

function quando(em: string) {
  const d = new Date(em);
  if (localDateStr(d) === localDateStr()) return formatBrazilTime(d);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });
}

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

function Avatar({ nome }: { nome: string }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-50 text-sm font-semibold text-accent-700">
      {iniciais(nome)}
    </span>
  );
}

function Lista() {
  const [conversas, setConversas] = useState<Conversa[] | null>(null);

  useEffect(() => {
    const carregar = () =>
      fetch("/taximetro/api/intern/mensagens")
        .then((r) => r.json())
        .then((j) => setConversas(j.success ? j.data.conversas : []))
        .catch(() => setConversas([]));
    carregar();
    const id = setInterval(carregar, 20_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="space-y-1 px-1">
        <h1 className="text-2xl font-semibold text-slate-900">Mensagens</h1>
        <p className="text-sm text-slate-500">Combine a troca direto com o colega, de qualquer faculdade.</p>
      </div>

      {conversas === null ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : conversas.length === 0 ? (
        <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
          <MessageCircle className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.5} />
          <p className="text-sm text-slate-600">Nenhuma conversa ainda.</p>
          <p className="text-xs text-slate-500">
            Em <Link href="/intern/trocas" className="font-semibold text-accent-600">Trocas</Link>, toque em <strong>Conversar</strong> numa oferta de colega. O Dai também abre conversa com o seu líder quando aparece vaga liberada para você.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {conversas.map((c) => (
            <li key={c.comId}>
              <Link href={`/intern/mensagens?com=${c.comId}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
                <Avatar nome={c.nome} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={cn("truncate text-sm text-slate-900", c.naoLidas > 0 ? "font-semibold" : "font-medium")}>{c.nome}</span>
                    {c.faculdade ? <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{c.faculdade}</span> : null}
                  </span>
                  <span className={cn("block truncate text-xs", c.naoLidas > 0 ? "text-slate-800" : "text-slate-500")}>
                    {c.ultima.minha ? "Você: " : ""}{c.ultima.texto}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[11px] text-slate-400">{quando(c.ultima.em)}</span>
                  {c.naoLidas > 0 ? (
                    <span className="min-w-5 rounded-full bg-accent-600 px-1.5 text-center text-[11px] font-semibold leading-5 text-white">{c.naoLidas}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Conversa({ com, troca, rascunho }: { com: string; troca: string | null; rascunho: string }) {
  const router = useRouter();
  const [pessoa, setPessoa] = useState<Pessoa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState(rascunho);
  const [enviando, setEnviando] = useState(false);
  const [requestId, setRequestId] = useState(troca);
  const fim = useRef<HTMLDivElement>(null);
  const quantas = useRef(0);

  const carregar = useCallback(async () => {
    const r = await fetch(`/taximetro/api/intern/mensagens?com=${com}`).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (!j?.success) {
      setErro(j?.error ?? "Não consegui abrir a conversa.");
      setMensagens([]);
      return;
    }
    setPessoa(j.data.pessoa);
    setMensagens(j.data.mensagens);
  }, [com]);

  useEffect(() => {
    carregar();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") carregar();
    }, ATUALIZAR_MS);
    return () => clearInterval(id);
  }, [carregar]);

  // Rola para a última só quando chega mensagem nova, não a cada atualização.
  useEffect(() => {
    if (mensagens && mensagens.length !== quantas.current) {
      quantas.current = mensagens.length;
      fim.current?.scrollIntoView({ block: "end" });
    }
  }, [mensagens]);

  async function enviar() {
    const conteudo = texto.trim();
    if (!conteudo || enviando) return;
    setEnviando(true);
    setErro(null);
    const r = await fetch("/taximetro/api/intern/mensagens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ para: com, texto: conteudo, ...(requestId ? { requestId } : {}) }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setEnviando(false);
    if (!j?.success) {
      setErro(j?.error ?? "Mensagem não foi. Tente de novo.");
      return;
    }
    setTexto("");
    setRequestId(null);
    // Rascunho da URL já foi usado; tira para não voltar num recarregar.
    if (rascunho || troca) router.replace(`/intern/mensagens?com=${com}`);
    carregar();
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3">
      <div className="flex items-center gap-3">
        <Link href="/intern/mensagens" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Voltar para as conversas">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        {pessoa ? (
          <>
            <Avatar nome={pessoa.nome} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{pessoa.nome}</p>
              {pessoa.faculdade ? <p className="text-xs text-slate-500">{pessoa.faculdade}</p> : null}
            </div>
          </>
        ) : null}
      </div>

      <div className="min-h-[45vh] space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
        {mensagens === null ? (
          <p className="text-sm text-slate-400">Carregando...</p>
        ) : mensagens.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-slate-500">
            {erro ?? "Mande a primeira mensagem. Diga qual plantão você quer trocar e o que oferece."}
          </p>
        ) : (
          mensagens.map((m) => (
            <div key={m.id} className={cn("flex", m.minha ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                  m.minha ? "rounded-br-md bg-accent-600 text-white" : "rounded-bl-md bg-slate-100 text-slate-900",
                )}
              >
                {m.texto}
                <span className={cn("mt-0.5 block text-right text-[10px]", m.minha ? "text-white/70" : "text-slate-400")}>{quando(m.em)}</span>
              </div>
            </div>
          ))
        )}
        <div ref={fim} />
      </div>

      {erro && mensagens && mensagens.length > 0 ? <p className="text-xs text-red-600">{erro}</p> : null}

      <div className="sticky bottom-24 flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
          rows={Math.min(4, Math.max(1, texto.split("\n").length))}
          maxLength={1000}
          placeholder="Escreva sua mensagem"
          className="min-h-10 flex-1 resize-none rounded-xl bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
        />
        <Button onClick={enviar} disabled={!texto.trim() || enviando} size="sm" className="h-10 w-10 shrink-0 rounded-full p-0" aria-label="Enviar">
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function Mensagens() {
  const params = useSearchParams();
  const com = params.get("com");
  if (!com) return <Lista />;
  return <Conversa key={com} com={com} troca={params.get("troca")} rascunho={params.get("texto") ?? ""} />;
}

export default function MensagensPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Carregando...</p>}>
      <Mensagens />
    </Suspense>
  );
}
