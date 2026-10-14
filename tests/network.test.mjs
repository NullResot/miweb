import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  allowedAddress,
  isProxyFakeIp,
  safeRequest,
  validateUrl,
} from "../server/network.mjs";

test("public deployments reject private, loopback, reserved and mapped IPv6 addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.4.1",
    "192.168.2.1",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "224.0.0.1",
  ])
    assert.equal(allowedAddress(address), false, address);
  assert.equal(allowedAddress("8.8.8.8"), true);
  assert.equal(allowedAddress("127.0.0.1", true), true);
  for (const address of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.2", "fd00::1"])
    assert.equal(allowedAddress(address, true), true);
  for (const address of ["169.254.169.254", "0.0.0.0", "224.0.0.1", "fe80::1"])
    assert.equal(allowedAddress(address, true), false);
});
test("rejects non-web schemes and credentials before making a request", async () => {
  await assert.rejects(validateUrl("file:///etc/passwd"), /HTTP/);
  await assert.rejects(validateUrl("https://user:pass@example.com"), /HTTP/);
  await assert.rejects(validateUrl("http://127.0.0.1"), /地址/);
});
test("only the synthetic VPN DNS range qualifies for public DNS recovery", () => {
  assert.equal(isProxyFakeIp("198.18.0.1"), true);
  assert.equal(isProxyFakeIp("198.19.255.255"), true);
  assert.equal(isProxyFakeIp("2001:2::8e"), true);
  for (const address of [
    "198.20.0.1",
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "::1",
  ])
    assert.equal(isProxyFakeIp(address), false);
});
test("local mode connects with pinned addresses, bounds response size and checks redirect targets", async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, {
        location: "http://169.254.169.254/latest/meta-data",
      });
      response.end();
    } else if (request.url === "/large") response.end("x".repeat(1000));
    else response.end("hello");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal(
    (await safeRequest(url, { localAccess: true })).body.toString(),
    "hello",
  );
  await assert.rejects(
    safeRequest(url + "/large", { localAccess: true, maxBytes: 10 }),
    /过大/,
  );
  await assert.rejects(
    safeRequest(url + "/redirect", { localAccess: true }),
    /地址/,
  );
});
