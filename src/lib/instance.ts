/**
 * instance.ts — quem é esta instalação, e o que ela tem.
 *
 * Uma única chave (`NEXT_PUBLIC_ORG`) decide a instância. Tudo que difere entre
 * SAMU e Vitalmed sai desta tabela — nada de variável de ambiente solta por
 * feature, e nada de branch paralelo carregando as diferenças.
 *
 * A tabela mora no código, versionada, de propósito: dá para ler numa tela só
 * quem tem o quê, a diferença aparece no diff de qualquer PR, e nenhuma das duas
 * instalações muda de comportamento por causa de um env editado no servidor.
 *
 * `NEXT_PUBLIC_*` é inlined no build do Next, e cada instância tem seu próprio
 * build Docker — então no build do SAMU as features da Vitalmed são constantes
 * `false`, e o código correspondente sequer é alcançável.
 */

export const INSTANCIAS = ["samu", "vitalmed"] as const;
export type Instancia = (typeof INSTANCIAS)[number];

/** Exportada para teste: sem env, ou com valor inválido, o resultado tem que ser SAMU. */
export function resolverInstancia(valor: string | undefined): Instancia {
  const normalizado = (valor || "").trim().toLowerCase();
  return (INSTANCIAS as readonly string[]).includes(normalizado)
    ? (normalizado as Instancia)
    : "samu"; // sem env (ou valor inválido) = SAMU, o build original
}

export const ORG: Instancia = resolverInstancia(process.env.NEXT_PUBLIC_ORG);

/** Funcionalidades que existem em uma instância e não na outra. */
export type Feature =
  /** Botão de sortear escala na tela do admin (hoje o sorteio só existe para o líder). */
  | "adminLottery"
  /** Interno marca indisponibilidade num plantão, e o sorteio respeita isso. */
  | "internUnavailability";

/**
 * A fonte da verdade. Ligar algo para o SAMU aqui é uma decisão explícita e
 * revisável — e o teste em tests/instance-features.test.ts falha se acontecer
 * sem querer.
 */
const FEATURES: Record<Instancia, Record<Feature, boolean>> = {
  samu: {
    adminLottery: false,
    internUnavailability: false,
  },
  vitalmed: {
    adminLottery: true,
    internUnavailability: true,
  },
};

/** Esta instância tem a feature? Aceita instância explícita para uso em teste. */
export function temFeature(feature: Feature, instancia: Instancia = ORG): boolean {
  return FEATURES[instancia][feature];
}

/** Cópia da tabela, para inspeção e teste. Não é referência ao objeto interno. */
export function featuresDe(instancia: Instancia): Record<Feature, boolean> {
  return { ...FEATURES[instancia] };
}

/**
 * Rótulos das escalas no menu. Os caminhos das rotas (`usa`, `cru`, `crl`) são
 * os mesmos nas duas instâncias — o que muda é o nome que o cliente usa e quais
 * aparecem. Vitalmed chama de APH/CCO e não tem CRL.
 */
type EscalaNav = { slug: "usa" | "cru" | "crl"; label: string };

const ESCALAS: Record<Instancia, EscalaNav[]> = {
  samu: [
    { slug: "usa", label: "Escala USA" },
    { slug: "cru", label: "Escala CRU" },
    { slug: "crl", label: "Escala CRL" },
  ],
  vitalmed: [
    { slug: "usa", label: "Escala APH" },
    { slug: "cru", label: "Escala CCO" },
  ],
};

export function escalasDaInstancia(instancia: Instancia = ORG): EscalaNav[] {
  return ESCALAS[instancia];
}

/** Esta escala existe nesta instância? Usado para bloquear a rota, não só o menu. */
export function temEscala(slug: EscalaNav["slug"], instancia: Instancia = ORG): boolean {
  return ESCALAS[instancia].some((e) => e.slug === slug);
}
