const key = process.env.AUTH_SECRET;

if (!key) {
  console.error("[telegram-reminder] AUTH_SECRET não configurado");
  process.exit(1);
}

const paths = [
  "/taximetro/api/telegram/checkin-pending-reminder",
  "/api/telegram/checkin-pending-reminder",
];

let lastError = null;

for (const path of paths) {
  const url = new URL(`http://127.0.0.1:3000${path}`);
  url.searchParams.set("key", key);

  try {
    const response = await fetch(url, { method: "GET" });
    const body = await response.text();
    console.log(`[telegram-reminder] ${path} -> ${response.status} ${body}`);
    if (response.ok) {
      process.exit(0);
    }
    lastError = new Error(`HTTP ${response.status}`);
  } catch (error) {
    lastError = error;
    console.error(`[telegram-reminder] ${path} falhou`, error);
  }
}

throw lastError ?? new Error("Falha ao disparar lembrete de check-in pendente");