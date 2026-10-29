/**
 * Cloudflare Pages Function — CORS 代理 / 短信接口转发
 *
 * 调用方式：
 *   1. 参数形式: https://your-domain.com/proxy?url=https://example.com/api
 *   2. 路径形式: https://your-domain.com/https://example.com/api
 *
 * ⚠️ 这个函数部署后就是一台「公开的开放代理」，任何人都能拿它转发请求。
 *    因此必须做好防护，否则 Cloudflare 账号会有被判定为滥用、进而被封的风险。
 *    这里做了三件事：
 *      1. 只允许 http / https 协议
 *      2. 阻断内网地址与云厂商元数据服务（SSRF）
 *      3. 逐跳校验重定向目标，最多 3 跳
 */

const MAX_REDIRECTS = 3;
const UPSTREAM_TIMEOUT_MS = 10000;

// 明确禁止访问的主机名
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

/**
 * 判断 IPv4 是否属于私有 / 保留 / 回环 / 元数据地址段
 */
function isPrivateIpv4(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return true;

  const n = parts.map((p) => Number(p));
  if (n.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return true;

  const [a, b, c] = n;
  if (a === 0) return true; // 0.0.0.0/8            本机
  if (a === 10) return true; // 10.0.0.0/8           私有
  if (a === 127) return true; // 127.0.0.0/8         回环
  if (a === 169 && b === 254) return true; // 169.254.0.0/16    链路本地（含 169.254.169.254 元数据）
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12     私有
  if (a === 192 && b === 168) return true; // 192.168.0.0/16    私有
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10     CGNAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24, 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24
  if (a >= 224) return true; // 224.0.0.0/4 组播 + 240.0.0.0/4 保留
  return false;
}

/**
 * 判断 IPv6 是否属于私有 / 回环 / 链路本地地址段
 */
function isPrivateIpv6(ip) {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return true;
  if (s.startsWith("fe80")) return true; // 链路本地
  if (s.startsWith("fc") || s.startsWith("fd")) return true; // 唯一本地地址
  if (s.startsWith("ff")) return true; // 组播

  // IPv4 映射地址 ::ffff:a.b.c.d
  const mapped = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

/**
 * 判断主机名是否应被阻断
 */
function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;

  // IPv4 字面量
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host);
  // IPv6 字面量
  if (host.includes(":")) return isPrivateIpv6(host);
  return false;
}

/**
 * 校验并规范化目标地址
 * @returns {{ ok: true, url: URL } | { ok: false, error: string }}
 */
function validateTarget(rawTarget) {
  let parsed;
  try {
    parsed = new URL(rawTarget);
  } catch {
    return { ok: false, error: "目标地址不是合法的 URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: `不支持的协议：${parsed.protocol}` };
  }

  if (isBlockedHostname(parsed.hostname)) {
    return { ok: false, error: "目标地址指向内网或保留地址，已拒绝" };
  }

  return { ok: true, url: parsed };
}

/**
 * 从路径里还原绝对 URL（兼容边缘节点把 "//" 折叠成 "/" 的情况）
 */
function extractTargetFromPath(pathname) {
  const raw = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  if (!raw) return null;

  const matched = raw.match(/^(https?):\/(.*)$/i);
  if (!matched) return null;

  return `${matched[1].toLowerCase()}://${matched[2]}`;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": "*",
  };
}

function errorResponse(status, message) {
  return new Response(message, {
    status,
    headers: corsHeaders(),
  });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // 1. 判断本次请求是不是代理请求
  let rawTarget = url.searchParams.get("url");
  if (!rawTarget) {
    rawTarget = extractTargetFromPath(url.pathname);
  }

  // 2. 不是代理请求 → 交回 Pages 处理静态资源
  if (!rawTarget) {
    return context.next();
  }

  // 3. 校验目标地址
  const target = validateTarget(rawTarget);
  if (!target.ok) {
    return errorResponse(400, `代理请求被拒绝：${target.error}`);
  }

  // 4. 组装上游请求
  //    host / origin / referer / cookie 一律不透传。
  //    - host 由 fetch 自行设置
  //    - referer / origin 若透传伪造值，等于帮请求伪装来源；
  //      公开代理这么干会很快被目标站风控识别，风险远大于收益
  const excludeHeaders = ["host", "origin", "referer", "cookie"];
  const headers = {};
  for (const [key, value] of request.headers) {
    if (!excludeHeaders.includes(key.toLowerCase())) {
      headers[key] = value;
    }
  }

  let body;
  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    body = await request.text();
  }

  // 5. 发起请求，手动跟随并逐跳校验重定向
  let currentUrl = target.url;
  let response;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      response = await fetch(currentUrl.toString(), {
        method: request.method,
        headers,
        body,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === "AbortError") {
        return errorResponse(504, "代理请求超时");
      }
      return errorResponse(502, `代理请求失败：${error.message}`);
    }
    clearTimeout(timeoutId);

    const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
    const location = response.headers.get("location");
    if (!isRedirect || !location) break;

    if (hop === MAX_REDIRECTS) {
      return errorResponse(508, "重定向次数过多");
    }

    let nextUrl;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      return errorResponse(502, "上游返回了非法的重定向地址");
    }

    const nextTarget = validateTarget(nextUrl.toString());
    if (!nextTarget.ok) {
      return errorResponse(400, `重定向目标被拒绝：${nextTarget.error}`);
    }
    currentUrl = nextTarget.url;
  }

  // 6. 回传响应
  const responseHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) {
    responseHeaders.set(key, value);
  }
  responseHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
  responseHeaders.set("Pragma", "no-cache");
  responseHeaders.set("Expires", "0");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
