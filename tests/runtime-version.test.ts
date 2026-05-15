import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

// Fonte única de verdade: .nvmrc
const nvmrcMajor = read(".nvmrc").trim().split(".")[0];

test(".nvmrc define um major de Node válido", () => {
  assert.match(nvmrcMajor, /^\d+$/, ".nvmrc deve conter um major numérico");
});

test("Dockerfile usa a mesma major de Node do .nvmrc", () => {
  const dockerfile = read("Dockerfile");
  const match = dockerfile.match(/FROM\s+node:(\d+)[.\d]*-alpine/);
  assert.ok(match, "Dockerfile deve usar uma imagem node:<major>-alpine");
  assert.equal(match![1], nvmrcMajor, "Dockerfile fora de sincronia com .nvmrc");
});

test("docker-compose.dev.yml usa a mesma major de Node do .nvmrc", () => {
  const compose = read("docker-compose.dev.yml");
  const images = [...compose.matchAll(/image:\s*node:(\d+)[.\d]*-alpine/g)];
  assert.ok(images.length > 0, "compose deve referenciar ao menos uma imagem node:*-alpine");
  for (const img of images) {
    assert.equal(img[1], nvmrcMajor, "docker-compose.dev.yml fora de sincronia com .nvmrc");
  }
});

test("package.json engines.node cobre a major do .nvmrc", () => {
  const pkg = JSON.parse(read("package.json")) as { engines?: { node?: string } };
  const engines = pkg.engines?.node ?? "";
  assert.ok(engines.includes(nvmrcMajor), `engines.node ("${engines}") deve incluir a major ${nvmrcMajor}`);
});

test("workflows de CI derivam a versão de Node do .nvmrc (sem hardcode)", () => {
  for (const wf of [".github/workflows/ci.yml", ".github/workflows/deploy.yml"]) {
    const content = read(wf);
    assert.match(content, /node-version-file:\s*['"]?\.nvmrc/, `${wf} deve usar node-version-file: .nvmrc`);
    assert.doesNotMatch(content, /node-version:\s*['"]?\d/, `${wf} não deve hardcodar node-version`);
  }
});
