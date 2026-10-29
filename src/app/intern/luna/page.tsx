"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeftRight, CalendarClock, ClipboardCheck, Loader2, MapPin, RotateCcw, Send, Sparkles, Target, Ticket, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LunaCartao, LunaMemoria } from "@/lib/luna-ferramentas";

type Msg = { role: "user" | "assistant"; content: string; cartoes?: LunaCartao[]; erro?: boolean; memoria?: LunaMemoria };

const GUARDA = "luna-interno-conversa";

// Os atalhos caem no caminho direto do Dai (sem modelo): ver luna-roteador.ts.
const ATALHOS = [
  { icone: Target, rotulo: "Que vagas fecham minha meta?", pergunta: "Que vagas fecham minha meta?" },
  { icone: ClipboardCheck, rotulo: "Tenho checkout pendente?", pergunta: "Tenho checkout pendente?" },
  { icone: Ticket, rotulo: "Tem vaga liberada pra mim?", pergunta: "Tem vaga liberada pra mim?" },
  { icone: ArrowLeftRight, rotulo: "Quero trocar um plantão", pergunta: "Quero trocar um plantão: que trocas servem pra mim?" },
  { icone: Zap, rotulo: "Tem extra aberto?", pergunta: "Tem plantão extra aberto pra mim?" },
  { icone: CalendarClock, rotulo: "Meus próximos plantões", pergunta: "Quais são meus próximos plantões?" },
] as const;

/** **negrito** e listas com "- ", sem HTML do modelo. */
function Texto({ texto }: { texto: string }) {
  const negrito = (linha: string): ReactNode[] =>
    linha.split(/\*\*(.+?)\*\*/g).map((parte, i) => (i % 2 ? <strong key={i}>{parte}</strong> : <Fragment key={i}>{parte}</Fragment>));
  const blocos: ReactNode[] = [];
  let lista: string[] = [];
  const fecharLista = () => {
    if (lista.length) {
      blocos.push(
        <ul key={`l${blocos.length}`} className="list-disc space-y-0.5 pl-4">
          {lista.map((l, i) => <li key={i}>{negrito(l)}</li>)}
        </ul>,
      );
      lista = [];
    }
  };
  for (const linha of texto.split("\n")) {
    const item = linha.match(/^\s*[-•*]\s+(.*)$/);
    if (item) lista.push(item[1]);
    else {
      fecharLista();
      if (linha.trim()) blocos.push(<p key={`p${blocos.length}`}>{negrito(linha)}</p>);
    }
  }
  fecharLista();
  return <div className="space-y-1.5">{blocos}</div>;
}

/** Candidatura a vaga livre: o próprio interno pede, a coordenação decide. */
function Candidatar({ offerId }: { offerId: string }) {
  const [estado, setEstado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  if (estado) {
    return <span className={cn("max-w-[55%] text-right text-xs", estado.ok ? "text-emerald-700" : "text-amber-700")}>{estado.texto}</span>;
  }
  return (
    <button
      type="button"
      disabled={enviando}
      onClick={async () => {
        setEnviando(true);
        const r = await fetch("/taximetro/api/intern/vagas-livres/candidatura", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offerId }),
        }).catch(() => null);
        const j = r ? await r.json().catch(() => null) : null;
        setEnviando(false);
        setEstado(j?.success
          ? { ok: true, texto: j.data?.already ? "Você já se candidatou." : "Candidatura enviada à coordenação." }
          : { ok: false, texto: j?.error ?? "Sem conexão. Tente de novo." });
      }}
      className="shrink-0 rounded-full bg-accent-600 px-3 py-1 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
    >
      {enviando ? "Enviando…" : "Me candidatar"}
    </button>
  );
}

function Cartao({ cartao }: { cartao: LunaCartao }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <h3 className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{cartao.titulo}</h3>
      <ul className="divide-y divide-slate-100">
        {cartao.itens.map((item, i) => (
          <li key={i} className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-900">{item.titulo}</span>
              {item.detalhe ? <span className="block truncate text-xs text-slate-500">{item.detalhe}</span> : null}
            </span>
            {item.mapa ? (
              <Link href={`/intern/bases?base=${encodeURIComponent(item.mapa)}`} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Ver ${item.mapa} no mapa`}>
                <MapPin className="h-4 w-4" />
              </Link>
            ) : null}
            {item.candidatar ? <Candidatar offerId={item.candidatar} /> : null}
            {item.href && item.acao ? (
              <Link href={item.href} className="shrink-0 rounded-full bg-accent-600 px-3 py-1 text-xs font-semibold text-white hover:bg-accent-700">
                {item.acao}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      {cartao.verTudo ? (
        <Link href={cartao.verTudo.href} className="block border-t border-slate-100 px-3 py-2 text-xs font-semibold text-accent-600 hover:bg-slate-50">
          {cartao.verTudo.rotulo} →
        </Link>
      ) : null}
    </section>
  );
}

export default function LunaPage() {
  const [conversa, setConversa] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [ligada, setLigada] = useState<boolean | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const salva = sessionStorage.getItem(GUARDA);
      if (salva) setConversa(JSON.parse(salva));
    } catch {}
    fetch("/taximetro/api/intern/luna")
      .then((r) => r.json())
      .then((j) => setLigada(Boolean(j.success && j.data.ligada)))
      .catch(() => setLigada(false));
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(GUARDA, JSON.stringify(conversa.slice(-20)));
    } catch {}
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversa, pensando]);

  async function perguntar(pergunta: string) {
    const conteudo = pergunta.trim();
    if (!conteudo || pensando) return;
    const nova = [...conversa, { role: "user" as const, content: conteudo }];
    setConversa(nova);
    setTexto("");
    setPensando(true);
    const r = await fetch("/taximetro/api/intern/luna", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensagens: nova.filter((m) => !m.erro).map(({ role, content, memoria }) => ({ role, content, ...(memoria ? { memoria } : {}) })) }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setPensando(false);
    setConversa([
      ...nova,
      j?.success
        ? { role: "assistant", content: j.data.texto, cartoes: j.data.cartoes, erro: j.data.erro, memoria: j.data.memoria }
        : { role: "assistant", content: j?.error ?? "Sem conexão. Tente de novo.", erro: true },
    ]);
  }

  const vazia = conversa.length === 0;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <div className="flex items-start gap-3 px-1">
        <div className="rounded-2xl bg-navy-900 p-2.5 text-white">
          <Sparkles className="h-5 w-5" strokeWidth={1.7} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-2xl font-semibold text-slate-900">Dai</h1>
            {!vazia ? (
              <button type="button" onClick={() => setConversa([])} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
                <RotateCcw className="h-3.5 w-3.5" /> Nova conversa
              </button>
            ) : null}
          </div>
          <p className="text-sm text-slate-500">Achar plantão, trocar, fechar a meta. Ele consulta seus dados e aponta onde resolver.</p>
        </div>
      </div>

      {ligada === false ? (
        <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>O Dai está desligado agora. O mesmo caminho, à mão:</p>
          <p className="flex flex-wrap gap-2">
            <Link href="/intern/trocas" className="rounded-full bg-white px-3 py-1 text-xs font-semibold ring-1 ring-amber-200">Trocas</Link>
            <Link href="/intern/extras" className="rounded-full bg-white px-3 py-1 text-xs font-semibold ring-1 ring-amber-200">Extras</Link>
            <Link href="/intern/bases" className="rounded-full bg-white px-3 py-1 text-xs font-semibold ring-1 ring-amber-200">Mapa das bases</Link>
            <Link href="/intern/mensagens" className="rounded-full bg-white px-3 py-1 text-xs font-semibold ring-1 ring-amber-200">Mensagens</Link>
          </p>
        </div>
      ) : null}

      {vazia ? (
        <div className="grid grid-cols-2 gap-2">
          {ATALHOS.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              disabled={ligada === false || pensando}
              onClick={() => perguntar(a.pergunta)}
              className="flex flex-col items-start gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-left text-sm font-medium text-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition hover:border-accent-300 active:scale-[0.98] disabled:opacity-50"
            >
              <a.icone className="h-4 w-4 text-accent-600" strokeWidth={1.8} />
              {a.rotulo}
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {conversa.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-600 px-3 py-2 text-sm text-white">{m.content}</p>
              </div>
            ) : (
              <div key={i} className="space-y-2">
                <div className={cn("max-w-[92%] rounded-2xl rounded-bl-md px-3 py-2 text-sm", m.erro ? "bg-amber-50 text-amber-900" : "bg-white text-slate-800 ring-1 ring-slate-200")}>
                  <Texto texto={m.content} />
                </div>
                {m.cartoes?.map((c) => <Cartao key={c.tipo} cartao={c} />)}
              </div>
            ),
          )}
          {pensando ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Consultando seus plantões…
            </p>
          ) : null}
        </div>
      )}

      <div ref={fim} />

      <div className="sticky bottom-24 space-y-2">
        {!vazia ? (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {ATALHOS.map((a) => (
              <button
                key={a.rotulo}
                type="button"
                disabled={pensando}
                onClick={() => perguntar(a.pergunta)}
                className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 disabled:opacity-50"
              >
                {a.rotulo}
              </button>
            ))}
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            perguntar(texto);
          }}
          className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"
        >
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={2000}
            disabled={ligada === false}
            placeholder="Ex.: não posso segunda, prefiro noite"
            className="min-h-10 flex-1 bg-transparent px-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <Button type="submit" disabled={!texto.trim() || pensando || ligada === false} size="sm" className="h-10 w-10 shrink-0 rounded-full p-0" aria-label="Perguntar">
            {pensando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
