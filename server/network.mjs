import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import ipaddr from "ipaddr.js";

const resolvedCache = new Map();
export function isProxyFakeIp(address) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.kind() === "ipv4"
      ? parsed.match(ipaddr.parse("198.18.0.0"), 15)
      : parsed.match(ipaddr.parse("2001:2::"), 48);
  } catch {
    return false;
  }
}
async function resolvePublicHostname(hostname) {
  const cached = resolvedCache.get(hostname);
  if (cached && Date.now() - cached.created < 60000) return cached.promise;
  // Some desktop VPNs return 198.18/15 synthetic DNS answers. Obtain the real public
  // address from a fixed, TLS-verified resolver and still pin the eventual TCP connection.
  const promise = new Promise((resolve, reject) => {
    const request = https.get(
      `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
      {
        headers: { accept: "application/dns-json" },
        timeout: 5000,
        agent: false,
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 16384) {
            reject(new Error("DNS 响应过大"));
            request.destroy();
          }
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            if (response.statusCode !== 200)
              throw new Error("无法解析公开网站地址");
            const result = JSON.parse(body);
            const answers = (result.Answer || [])
              .filter((answer) => answer.type === 1)
              .map((answer) => ({ address: answer.data, family: 4 }));
            if (
              !answers.length ||
              answers.some((answer) => !allowedAddress(answer.address))
            )
              throw new Error("无法解析公开网站地址");
            resolve(answers);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.on("timeout", () => {
      reject(new Error("公开 DNS 解析超时"));
      request.destroy();
    });
  });
  if (resolvedCache.size > 500) resolvedCache.clear();
  resolvedCache.set(hostname, { created: Date.now(), promise });
  return promise.catch((error) => {
    resolvedCache.delete(hostname);
    throw error;
  });
}

export function allowedAddress(address, localAccess = false) {
  try {
    const parsed = ipaddr.process(address);
    const range = parsed.range();
    return range === "unicast" || (localAccess && range === "loopback");
  } catch {
    return false;
  }
}

export async function validateUrl(input, localAccess = false) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("请输入完整的网址，例如 https://example.com");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("仅支持不含账号密码的 HTTP 或 HTTPS 地址");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses = ipaddr.isValid(hostname)
    ? [
        {
          address: hostname,
          family: ipaddr.parse(hostname).kind() === "ipv6" ? 6 : 4,
        },
      ]
    : await dns.lookup(hostname, { all: true });
  if (
    !ipaddr.isValid(hostname) &&
    addresses.length &&
    addresses.every((item) => isProxyFakeIp(item.address))
  )
    addresses = await resolvePublicHostname(hostname);
  if (
    !addresses.length ||
    addresses.some((item) => !allowedAddress(item.address, localAccess))
  )
    throw new Error(
      "这个地址不能访问。公开服务仅支持公开网站；本地服务可访问 localhost",
    );
  return { url, addresses };
}

// Pin each validated DNS answer to the actual TCP connection; revalidate every redirect.
export async function safeRequest(
  input,
  {
    localAccess = false,
    method = "GET",
    headers = {},
    body,
    maxBytes = 8 * 1024 * 1024,
    redirects = 5,
    followRedirects = true,
  } = {},
) {
  const { url, addresses } = await validateUrl(input, localAccess);
  const address = addresses[0];
  const allowedHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (
      [
        "accept",
        "accept-language",
        "content-type",
        "user-agent",
        "referer",
        "origin",
      ].includes(name.toLowerCase())
    )
      allowedHeaders[name] = value;
  }
  allowedHeaders["accept-encoding"] = "identity";
  const response = await new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method,
        headers: allowedHeaders,
        agent: false,
        lookup: (_hostname, options, callback) =>
          options.all
            ? callback(null, [address])
            : callback(null, address.address, address.family),
        timeout: 15000,
      },
      (incoming) => {
        const chunks = [];
        let size = 0;
        incoming.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            const error = new Error("页面资源过大，无法载入");
            reject(error);
            incoming.destroy(error);
            request.destroy(error);
          } else chunks.push(chunk);
        });
        incoming.on("error", reject);
        incoming.on("end", () => {
          try {
            let bytes = Buffer.concat(chunks);
            const encoding = incoming.headers["content-encoding"];
            if (encoding === "gzip")
              bytes = gunzipSync(bytes, { maxOutputLength: maxBytes });
            if (encoding === "deflate")
              bytes = inflateSync(bytes, { maxOutputLength: maxBytes });
            if (encoding === "br")
              bytes = brotliDecompressSync(bytes, {
                maxOutputLength: maxBytes,
              });
            resolve({
              status: incoming.statusCode,
              headers: incoming.headers,
              body: bytes,
              url: url.href,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.on("timeout", () =>
      request.destroy(new Error("网站响应超时，请重试或导入本地项目")),
    );
    if (body) request.write(body);
    request.end();
  });
  if (
    [301, 302, 303, 307, 308].includes(response.status) &&
    response.headers.location
  ) {
    if (!redirects) throw new Error("网站重定向次数过多");
    await validateUrl(
      new URL(response.headers.location, url).href,
      localAccess,
    );
    if (!followRedirects) return response;
    const switchToGet =
      response.status === 303 ||
      ([301, 302].includes(response.status) && method === "POST");
    return safeRequest(new URL(response.headers.location, url).href, {
      localAccess,
      method: switchToGet ? "GET" : method,
      headers,
      body: switchToGet ? undefined : body,
      maxBytes,
      redirects: redirects - 1,
      followRedirects,
    });
  }
  return response;
}
