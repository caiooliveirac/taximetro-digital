const key = process.env.AUTH_SECRET;

if (!key) {
  console.error("[absence-sweep] AUTH_SECRET não configurado");
  process.exit(1);
}

const paths = [
  "/taximetro/api/cron/absence-sweep",
  "/api/cron/absence-sweep",
];

let lastError = null;

for (const path of paths) {
  const url = new URL(`http://127.0.0.1:3000${path}`);
  url.searchParams.set("key", key);

  try {
    const response = await fetch(url, { method: "GET" });
    const body = await response.text();
    console.log(`[absence-sweep] ${path} -> ${response.status} ${body}`);
    if (response.ok) {
      process.exit(0);
    }
    lastError = new Error(`HTTP ${response.status}`);
  } catch (error) {
    lastError = error;
    console.error(`[absence-sweep] ${path} falhou`, error);
  }
}

throw lastError ?? new Error("Falha ao disparar a varredura de faltas");
