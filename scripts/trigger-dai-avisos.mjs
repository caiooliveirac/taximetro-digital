// Dispara um tipo de aviso da Dai: node scripts/trigger-dai-avisos.mjs plantao|vagas|lideres
const key = process.env.AUTH_SECRET;
const tipo = process.argv[2];

if (!key || !tipo) {
  console.error("[dai-avisos] uso: AUTH_SECRET=... node scripts/trigger-dai-avisos.mjs plantao|vagas|lideres");
  process.exit(1);
}

const url = new URL("http://127.0.0.1:3000/taximetro/api/cron/dai-avisos");
url.searchParams.set("key", key);
url.searchParams.set("tipo", tipo);

try {
  const response = await fetch(url, { method: "GET" });
  const body = await response.text();
  // Sem a amostra do texto no log: tem nome de base e data de plantão.
  console.log(`[dai-avisos] ${tipo} -> ${response.status} ${body.replace(/"amostra":"(?:[^"\\]|\\.)*",?/, "")}`);
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  console.error(`[dai-avisos] ${tipo} falhou`, error);
  process.exit(1);
}
