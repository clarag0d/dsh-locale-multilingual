#!/usr/bin/env node
/**
 * verify.mjs —— 语言包自检
 * ============================================================================
 * 这个脚本不依赖任何第三方包，`node scripts/verify.mjs` 就能跑。
 *
 * 它检查四件事：
 *
 *   1. 每个 lang/*.json 结构合法（有 dicts / texts，且都是对象）；
 *   2. 三种语言之间的 namespace 集合、每个 namespace 的 key 集合**完全相同**；
 *   3. 三种语言的界面白名单（texts）key 集合**完全相同**；
 *   4. 代码里的标识符与包名一致（client.js 的 load id、cordis.patch.yml 的 id）。
 *
 * 为什么只做「互相一致」而不和 DSH 比：DSH 升级会增删词条，仓库里没有它的词表快照，
 * 硬编码一份只会不断过期。只要三种语言始终对齐，就不会出现「某种语言少翻一片」；
 * 需要跟 DSH 对齐时，用 `--baseline <file>` 传入一份快照（格式见下）。
 *
 * 基线文件格式（可选）：
 *   { "dicts": { "<namespace>": ["<key>", ...] }, "texts": ["<原文>", ...] }
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const langDir = path.join(root, "lang");

const errors = [];
const fail = (message) => errors.push(message);

/* ────────────────────────── 读取 ────────────────────────── */

function loadPacks() {
  if (!existsSync(langDir)) {
    fail("找不到 lang/ 目录：" + langDir);
    return {};
  }
  const packs = {};
  for (const name of readdirSync(langDir).sort()) {
    if (!name.endsWith(".json")) continue;
    const id = name.slice(0, -5);
    const file = path.join(langDir, name);
    try {
      const pack = JSON.parse(readFileSync(file, "utf8"));
      if (!pack || typeof pack !== "object") throw new Error("不是对象");
      if (!pack.dicts || typeof pack.dicts !== "object" || Array.isArray(pack.dicts)) {
        throw new Error("缺少 dicts 对象");
      }
      if (!pack.texts || typeof pack.texts !== "object" || Array.isArray(pack.texts)) {
        throw new Error("缺少 texts 对象");
      }
      packs[id] = pack;
    } catch (err) {
      fail("lang/" + name + " 解析失败：" + (err && err.message ? err.message : String(err)));
    }
  }
  return packs;
}

/* ────────────────────────── 比较 ────────────────────────── */

const sorted = (list) => list.slice().sort();
const sameSet = (a, b) => sorted(a).join("\u0001") === sorted(b).join("\u0001");

function diffSets(expected, actual) {
  const missing = expected.filter((k) => !actual.includes(k));
  const extra = actual.filter((k) => !expected.includes(k));
  return { missing, extra };
}

function keySetOf(pack) {
  const out = {};
  for (const [ns, dict] of Object.entries(pack.dicts)) out[ns] = Object.keys(dict);
  return out;
}

function compareToReference(referenceId, packs) {
  const reference = packs[referenceId];
  const refKeys = keySetOf(reference);
  const refNs = Object.keys(refKeys);
  const refTexts = Object.keys(reference.texts);

  for (const [id, pack] of Object.entries(packs)) {
    if (id === referenceId) continue;
    const keys = keySetOf(pack);

    for (const ns of refNs) {
      if (!keys[ns]) {
        fail(id + "：缺少 namespace " + ns);
        continue;
      }
      const { missing, extra } = diffSets(refKeys[ns], keys[ns]);
      if (missing.length) fail(id + "：" + ns + " 缺少 " + missing.length + " 个 key（例如 " + missing[0] + "）");
      if (extra.length) fail(id + "：" + ns + " 多出 " + extra.length + " 个 key（例如 " + extra[0] + "）");
    }
    for (const ns of Object.keys(keys)) {
      if (!refKeys[ns]) fail(id + "：多出 namespace " + ns);
    }

    const { missing: textMissing, extra: textExtra } = diffSets(refTexts, Object.keys(pack.texts));
    if (textMissing.length) fail(id + "：texts 缺少 " + textMissing.length + " 条（例如 " + textMissing[0] + "）");
    if (textExtra.length) fail(id + "：texts 多出 " + textExtra.length + " 条（例如 " + textExtra[0] + "）");
  }
}

function compareToBaseline(baselineFile, packs) {
  if (!baselineFile) return;
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
  } catch (err) {
    fail("基线文件读取失败：" + (err && err.message ? err.message : String(err)));
    return;
  }
  const refNs = Object.keys(baseline.dicts || {});
  for (const [id, pack] of Object.entries(packs)) {
    const keys = keySetOf(pack);
    for (const ns of refNs) {
      if (!keys[ns]) { fail(id + "：基线有 namespace " + ns + "，实际缺失"); continue; }
      const missing = baseline.dicts[ns].filter((k) => !keys[ns].includes(k));
      if (missing.length) fail(id + "：" + ns + " 相对基线缺少 " + missing.length + " 个 key");
    }
    const missingTexts = (baseline.texts || []).filter((k) => !(k in pack.texts));
    if (missingTexts.length) fail(id + "：相对基线缺少 " + missingTexts.length + " 条 texts");
  }
}

/* ────────────────────────── 代码标识符 ────────────────────────── */

function checkIdentity() {
  const pkgFile = path.join(root, "package.json");
  const clientFile = path.join(root, "client.js");
  const patchFile = path.join(root, "cordis.patch.yml");
  let name = "";
  try {
    name = JSON.parse(readFileSync(pkgFile, "utf8")).name || "";
  } catch (err) {
    fail("package.json 读取失败");
    return;
  }
  if (!name) { fail("package.json 缺少 name"); return; }

  if (existsSync(clientFile)) {
    const client = readFileSync(clientFile, "utf8");
    // 注意：文件头的注释里也有一个示例（id: '<包名>'），所以取最后一个匹配。
    const matches = [...client.matchAll(/__ModuleLoader__\.load\(\{\s*id:\s*['"]([^'"]+)['"]/g)];
    const match = matches.length ? matches[matches.length - 1] : null;
    if (!match) fail("client.js 里找不到 __ModuleLoader__.load({ id })");
    else if (match[1] !== name) {
      fail("client.js 的 id（" + match[1] + "）与包名（" + name + "）不一致——插件会加载但不注册");
    }
  }

  if (existsSync(patchFile)) {
    const patch = readFileSync(patchFile, "utf8");
    if (!patch.includes("id: " + name)) fail("cordis.patch.yml 的 id 不是 " + name);
  }
}

/* ────────────────────────── 输出 ────────────────────────── */

const packs = loadPacks();
const ids = Object.keys(packs);

if (ids.length === 0) {
  fail("lang/ 下没有任何语言文件");
} else {
  compareToReference(ids[0], packs);
  const baselineArg = process.argv.indexOf("--baseline");
  if (baselineArg > -1) compareToBaseline(process.argv[baselineArg + 1], packs);
}

checkIdentity();

console.log("语言包自检\n");
for (const id of ids) {
  const pack = packs[id];
  const ns = Object.keys(pack.dicts);
  const keys = ns.reduce((sum, name) => sum + Object.keys(pack.dicts[name]).length, 0);
  const texts = Object.keys(pack.texts).length;
  console.log("  " + id.padEnd(4) + " namespace " + String(ns.length).padStart(3) +
    " · 词条 " + String(keys).padStart(5) + " · 白名单 " + String(texts).padStart(4));
}

if (errors.length) {
  console.error("\n发现 " + errors.length + " 个问题：");
  for (const message of errors) console.error("  ✗ " + message);
  process.exitCode = 1;
} else {
  console.log("\n✓ 三种语言覆盖率一致，代码标识符与包名一致");
}
