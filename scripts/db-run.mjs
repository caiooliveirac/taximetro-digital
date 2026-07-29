/**
 * db-run.mjs — porta de entrada única para TODO comando que toca banco.
 *
 * Motivo: antes, todos os scripts db:* liam o mesmo `.env.local`. Bastava esse
 * arquivo estar apontando para o lugar errado na hora errada para um `db:reset`
 * apagar o banco da instância errada — ou de produção. Não havia nada impedindo.
 *
 * Agora cada instância tem seu próprio arquivo de env e a instância é sempre
 * explícita na linha de comando:
 *
 *   node scripts/db-run.mjs samu     drizzle-kit push
 *   node scripts/db-run.mjs vitalmed tsx src/db/seed-vitalmed.ts
 *
 * O script carrega o env da instância pedida, confere se o DATABASE_URL
 * realmente pertence a ela e só então executa o comando. Qualquer divergência
 * aborta antes de abrir conexão.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Instâncias conhecidas. `padraoBanco` é o que o nome do banco PRECISA conter
 * para que o comando seja aceito — é isso que impede pedir `vitalmed` e acabar
 * executando contra o banco do SAMU (e vice-versa).
 */
const INSTANCIAS = {
  samu: { envFile: ".env.samu.local", padraoBanco: "taximetro" },
  vitalmed: { envFile: ".env.vitalmed.local", padraoBanco: "vitalmed" },
};

const HOSTS_LOCAIS = ["localhost", "127.0.0.1", "::1", "db"];

/** Comandos que destroem ou reescrevem dados — exigem confirmação extra fora do local. */
const PADROES_DESTRUTIVOS = ["clean-dev", "seed-prod", "seed-vitalmed", "push", "drop", "migrate"];

function abortar(titulo, ...detalhes) {
  console.error(`\n❌ ABORTADO: ${titulo}`);
  for (const linha of detalhes) console.error(`   ${linha}`);
  console.error("");
  process.exit(1);
}

/** Esconde a senha antes de qualquer coisa ir para o terminal ou log. */
function mascarar(url) {
  return url.replace(/:\/\/[^@]+@/, "://<credenciais>@");
}

/**
 * Parser de .env deliberadamente simples: só `CHAVE=valor`, ignora comentários
 * e linhas vazias, tira aspas das pontas. Não expande variáveis nem interpreta
 * nada — é arquivo de segredo, quanto menos esperteza, melhor.
 */
function lerEnvFile(caminho) {
  const env = {};
  for (const linha of readFileSync(caminho, "utf8").split("\n")) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) continue;
    const igual = limpa.indexOf("=");
    if (igual === -1) continue;
    const chave = limpa.slice(0, igual).trim();
    let valor = limpa.slice(igual + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    env[chave] = valor;
  }
  return env;
}

const [instanciaPedida, ...comando] = process.argv.slice(2);

if (!instanciaPedida || comando.length === 0) {
  abortar(
    "faltou dizer a instância e o comando.",
    "Uso: node scripts/db-run.mjs <samu|vitalmed> <comando...>",
    "Ex.:  node scripts/db-run.mjs vitalmed tsx src/db/seed-vitalmed.ts",
  );
}

const instancia = INSTANCIAS[instanciaPedida];
if (!instancia) {
  abortar(
    `instância "${instanciaPedida}" não existe.`,
    `Instâncias válidas: ${Object.keys(INSTANCIAS).join(", ")}`,
  );
}

// ── 1. O arquivo de env da instância precisa existir ─────────────
const caminhoEnv = resolve(process.cwd(), instancia.envFile);
if (!existsSync(caminhoEnv)) {
  abortar(
    `não achei ${instancia.envFile}.`,
    `Cada instância tem o seu arquivo — o ".env.local" genérico foi aposentado`,
    `justamente porque servia para as duas e era a origem da confusão.`,
    `Copie de .env.example e preencha o DATABASE_URL da instância ${instanciaPedida}.`,
  );
}

const env = lerEnvFile(caminhoEnv);
const databaseUrl = env.DATABASE_URL;

if (!databaseUrl) {
  abortar(`${instancia.envFile} não define DATABASE_URL.`);
}

// ── 2. O banco apontado tem que ser mesmo o da instância pedida ──
let url;
try {
  url = new URL(databaseUrl);
} catch {
  abortar("DATABASE_URL não é uma URL válida.", mascarar(databaseUrl));
}

const nomeBanco = url.pathname.replace(/^\//, "");
if (!nomeBanco.includes(instancia.padraoBanco)) {
  abortar(
    `o banco não parece ser o da instância "${instanciaPedida}".`,
    `Banco apontado:  ${nomeBanco}`,
    `Esperado conter: "${instancia.padraoBanco}"`,
    `Isto é a trava contra rodar comando de uma instância no banco da outra.`,
  );
}

// A checagem inversa fecha o cerco: um banco chamado "vitalmed" nunca pode ser
// alvo de um comando pedido como "samu", mesmo que "taximetro" apareça no nome.
for (const [nome, outra] of Object.entries(INSTANCIAS)) {
  if (nome === instanciaPedida) continue;
  if (nomeBanco.includes(outra.padraoBanco)) {
    abortar(
      `o banco "${nomeBanco}" parece ser da instância "${nome}", não de "${instanciaPedida}".`,
      `Confira o DATABASE_URL em ${instancia.envFile}.`,
    );
  }
}

// ── 3. Fora de localhost é produção até prova em contrário ───────
const ehLocal = HOSTS_LOCAIS.includes(url.hostname);
const linhaComando = comando.join(" ");
const ehDestrutivo = PADROES_DESTRUTIVOS.some((p) => linhaComando.includes(p));

if (!ehLocal) {
  const confirmacao = process.env.CONFIRMAR_BANCO;
  if (confirmacao !== nomeBanco) {
    abortar(
      "este DATABASE_URL não é local — é banco de verdade, com dados de verdade.",
      `Host:  ${url.hostname}`,
      `Banco: ${nomeBanco}`,
      ``,
      `Se você tem certeza, repita o nome do banco na confirmação:`,
      `  CONFIRMAR_BANCO=${nomeBanco} npm run <comando>`,
      ``,
      `Digitar o nome à mão é de propósito: é a diferença entre uma decisão`,
      `e um comando repetido sem pensar.`,
    );
  }
  if (ehDestrutivo) {
    console.error(`\n⚠️  Comando destrutivo em banco NÃO-LOCAL, confirmado à mão:`);
    console.error(`   host=${url.hostname} banco=${nomeBanco}`);
    console.error(`   comando: ${linhaComando}\n`);
  }
}

// ── 4. Tudo conferido: executa ───────────────────────────────────
console.error(
  `▶ instância=${instanciaPedida} banco=${nomeBanco} host=${url.hostname}${ehLocal ? " (local)" : " (REMOTO)"}`,
);

const resultado = spawnSync(comando[0], comando.slice(1), {
  stdio: "inherit",
  env: { ...process.env, ...env },
  shell: false,
});

if (resultado.error) {
  abortar(`falhou ao executar "${comando[0]}".`, String(resultado.error.message));
}
process.exit(resultado.status ?? 1);
