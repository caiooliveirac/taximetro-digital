const key = process.env.AUTH_SECRET;

if (!key) {
  console.error("[cohort-lifecycle] AUTH_SECRET não configurado");
  process.exit(1);
}

const paths = [
  "/taximetro/api/cron/cohort-lifecycle",
  "/api/cron/cohort-lifecycle",
];

// PORT vem do container (instâncias distintas rodam em portas distintas no host).
const appPort = process.env.PORT || "3000";

let lastError = null;

for (const path of paths) {
  const url = new URL(`http://127.0.0.1:${appPort}${path}`);
  url.searchParams.set("key", key);

  try {
    const response = await fetch(url, { method: "GET" });
    const body = await response.text();
    console.log(`[cohort-lifecycle] ${path} -> ${response.status} ${body}`);
    if (response.ok) {
      process.exit(0);
    }
    lastError = new Error(`HTTP ${response.status}`);
  } catch (error) {
    lastError = error;
    console.error(`[cohort-lifecycle] ${path} falhou`, error);
  }
}

throw lastError ?? new Error("Falha ao disparar o lifecycle de turmas");
