import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import nextConfig from "../next.config";

function collectCodeFiles(dir: string, out: string[] = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectCodeFiles(fullPath, out);
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      out.push(fullPath);
    }
  }
  return out;
}

test("next config locks basePath and assetPrefix to /taximetro", () => {
  assert.equal(nextConfig.basePath, "/taximetro");
  assert.equal(nextConfig.assetPrefix, "/taximetro");
});

test("client fetch calls do not bypass basePath with /api/*", () => {
  const repoRoot = process.cwd();
  const roots = [
    path.join(repoRoot, "src", "app"),
    path.join(repoRoot, "src", "components"),
  ];

  const violations: string[] = [];
  const bypassPattern = /fetch\(\s*(["'`])\s*\/api\//g;

  for (const root of roots) {
    for (const file of collectCodeFiles(root)) {
      const normalized = file.replace(/\\/g, "/");
      if (normalized.includes("/src/app/api/")) continue;

      const content = fs.readFileSync(file, "utf8");
      if (bypassPattern.test(content)) {
        violations.push(path.relative(repoRoot, file));
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Found fetch('/api/...') without /taximetro prefix in: ${violations.join(", ")}`,
  );
});

test("telegram token fallback remains explicit and visible", () => {
  const file = path.join(process.cwd(), "src", "lib", "telegram.ts");
  const content = fs.readFileSync(file, "utf8");

  assert.match(content, /TELEGRAM_BOT_TOKEN_NEXT\?\.trim\(\)/);
  assert.match(content, /\|\|\s*process\.env\.TELEGRAM_BOT_TOKEN\?\.trim\(\)/);
  assert.match(content, /console\.warn\("TELEGRAM_BOT_TOKEN not set/);
});

test("extra-offer claim remains atomic and rollback cleanup stays safe", () => {
  const repoFile = path.join(
    process.cwd(),
    "src",
    "features",
    "extra-offers",
    "infra",
    "repositories",
    "extra-offer-repository.ts",
  );
  const useCaseFile = path.join(
    process.cwd(),
    "src",
    "features",
    "extra-offers",
    "application",
    "use-cases",
    "claim-extra-offer.ts",
  );

  const repoContent = fs.readFileSync(repoFile, "utf8");
  const useCaseContent = fs.readFileSync(useCaseFile, "utf8");

  assert.match(repoContent, /eq\(extraShiftOffers\.id, offerId\)/);
  assert.match(repoContent, /isNull\(extraShiftOffers\.claimedBy\)/);
  assert.match(repoContent, /isNull\(extraShiftOffers\.cancelledAt\)/);
  assert.match(useCaseContent, /db\.delete\(assignments\)\.where\(eq\(assignments\.id, assignmentId\)\)/);
});
