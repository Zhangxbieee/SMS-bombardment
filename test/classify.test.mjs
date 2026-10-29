/**
 * classifyResponse 单元测试
 *
 * 从 index.html 里抽取判定函数与相关常量直接运行，
 * 避免复制一份实现导致测试与线上代码走样。
 *
 * 运行：node test/classify.test.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "public", "index.html"), "utf8");

/**
 * 按字符串 / 模板字面量感知的规则抽取函数定义
 * （朴素的花括号计数会被 `'{'` 这类字面量里的括号带偏）
 */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`未找到函数：${name}`);

  let depth = 0;
  let i = source.indexOf("{", start);
  let quote = null;

  while (i < source.length) {
    const c = source[i];
    if (quote) {
      if (c === "\\") { i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; i++; continue; }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") { i = source.indexOf("*/", i) + 2; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return source.slice(start, i + 1); }
    i++;
  }
  throw new Error(`函数括号不配对：${name}`);
}

/** 抽取顶层 const 的值表达式 */
function extractConst(source, name) {
  const matched = source.match(new RegExp(`const\\s+${name}\\s*=\\s*`));
  if (!matched) throw new Error(`未找到常量：${name}`);

  const start = matched.index + matched[0].length;
  let depth = 0;
  let i = start;
  let quote = null;

  while (i < source.length) {
    const c = source[i];
    if (quote) {
      if (c === "\\") { i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; i++; continue; }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") { i = source.indexOf("*/", i) + 2; continue; }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (depth === 0 && (c === ";" || c === "\n")) return source.slice(start, i);
    i++;
  }
  throw new Error(`常量表达式不配对：${name}`);
}

const constNames = [
  "BUSINESS_SUCCESS_CODES",
  "SUCCESS_KEYWORDS",
  "FAILURE_KEYWORDS",
  "CODE_KEYS",
  "MESSAGE_KEYS",
];

const source = [
  ...constNames.map((n) => `const ${n} = ${extractConst(html, n)};`),
  extractFunction(html, "truncate"),
  extractFunction(html, "pickCode"),
  extractFunction(html, "pickMessage"),
  extractFunction(html, "classifyResponse"),
].join("\n");

const { classifyResponse } = new Function(`${source}\nreturn { classifyResponse };`)();

const cases = [
  ["HTTP 200 + code:0 成功", 200, "application/json", '{"code":0,"msg":"发送成功"}', "sent"],
  ["HTTP 200 + code:500 业务失败", 200, "application/json", '{"code":500,"msg":"发送过于频繁"}', "failed"],
  ["HTTP 200 + success:false", 200, "application/json", '{"success":false,"message":"手机号已存在"}', "failed"],
  ["HTTP 200 + success:true", 200, "application/json", '{"success":true}', "sent"],
  ["HTTP 200 + 无业务字段", 200, "application/json", '{"data":123}', "unknown"],
  ["HTTP 200 + 嵌套 data.code=0", 200, "application/json", '{"data":{"code":0,"msg":"ok"}}', "sent"],
  ["HTTP 200 + 嵌套 code!=0", 200, "application/json", '{"data":{"code":30001,"msg":"请稍后再试"}}', "failed"],
  ["HTTP 200 + 纯文本成功", 200, "text/plain", "发送成功", "sent"],
  ["HTTP 200 + 纯文本失败", 200, "text/plain", "请求过于频繁", "failed"],
  ["HTTP 200 + HTML 错误页", 200, "text/html", "<html><body>404</body></html>", "unknown"],
  ["HTTP 200 + 本站首页(代理失效)", 200, "text/html", "<h2>Safety box攻击系统</h2>", "failed"],
  ["HTTP 403", 403, "application/json", "{}", "failed"],
  ["HTTP 429", 429, "application/json", "{}", "failed"],
  ["HTTP 500", 500, "text/html", "oops", "failed"],
  ['HTTP 200 + code:"0" 字符串', 200, "application/json", '{"code":"0"}', "sent"],
  ["HTTP 200 + status:true", 200, "application/json", '{"status":true}', "sent"],
  ["HTTP 200 + status:error", 200, "application/json", '{"status":"error"}', "failed"],
  ["HTTP 200 + 空 body", 200, "application/json", "", "unknown"],
  ["HTTP 200 + 二进制无标识", 200, "text/plain", "\u0000\u0001binary", "unknown"],
];

let passed = 0;
let failed = 0;

for (const [desc, status, contentType, body, expected] of cases) {
  const actual = classifyResponse(status, contentType, body);
  const ok = actual.state === expected;
  ok ? passed++ : failed++;
  const mark = ok ? "✅" : "❌";
  console.log(
    `${mark} ${desc.padEnd(28)} → ${actual.state.padEnd(8)} 期望 ${expected.padEnd(8)} | ${actual.reason}`,
  );
}

console.log(`\n通过 ${passed}/${passed + failed}`);
process.exit(failed ? 1 : 0);
