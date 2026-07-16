import { describe, it, expect, afterEach } from "vitest";
import * as net from "node:net";
import { Buffer } from "node:buffer";
import { NodeDOSServer } from "@nodedos/server";
import { NodeDOSClient, RemoteDriver } from "@nodedos/client";
import { MemoryDriver } from "@nodedos/fs-drivers";

const PORT_BASE = 19100;
let nextPort = PORT_BASE;

function freshPort(): number {
  return nextPort++;
}

async function until(cond: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("condition not met within timeout");
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()!;
    try {
      await fn();
    } catch {
      // already closed
    }
  }
});

describe("request timeouts", () => {
  it("rejects a request when the server never responds", async () => {
    // A server that accepts connections but never replies.
    const port = freshPort();
    const accepted: net.Socket[] = [];
    const silent = net.createServer((s) => accepted.push(s));
    await new Promise<void>((r) => silent.listen(port, "127.0.0.1", r));
    cleanups.push(
      () =>
        new Promise((r) => {
          for (const s of accepted) s.destroy();
          silent.close(() => r(undefined));
        }),
    );

    const client = new NodeDOSClient({ requestTimeoutMs: 100 });
    await client.connect("127.0.0.1", port);
    cleanups.push(() => client.disconnect());

    await expect(
      client.request({ type: "tstat", path: "/" }),
    ).rejects.toThrow(/timed out/i);
  });
});

describe("fail-fast when disconnected", () => {
  it("rejects requests immediately after the server goes away", async () => {
    const port = freshPort();
    const server = new NodeDOSServer();
    server.namespace.mount("/", new MemoryDriver());
    await server.listen(port, "127.0.0.1");

    const client = new NodeDOSClient();
    await client.connect("127.0.0.1", port);
    cleanups.push(() => client.disconnect());

    // Sanity: works while up.
    const r = await client.request({ type: "tstat", path: "/" });
    expect(r.type).toBe("rstat");

    // Crash the server (close() must sever live connections).
    await server.close();

    // Wait for the client to observe the close.
    await until(async () => !client.isConnected());

    // Now requests must reject promptly, not hang.
    await expect(
      client.request({ type: "tstat", path: "/" }),
    ).rejects.toThrow(/not connected/i);
  });
});

describe("automatic reconnect with backoff", () => {
  it("recovers after the server restarts on the same port", async () => {
    const port = freshPort();
    let server = new NodeDOSServer();
    server.namespace.mount("/", new MemoryDriver());
    await server.listen(port, "127.0.0.1");

    const client = new NodeDOSClient({
      reconnect: true,
      reconnectBaseMs: 25,
      reconnectMaxMs: 100,
    });
    await client.connect("127.0.0.1", port);
    cleanups.push(() => client.disconnect());

    const r1 = await client.request({ type: "tstat", path: "/" });
    expect(r1.type).toBe("rstat");

    // Crash and restart the server.
    await server.close();
    await until(async () => !client.isConnected());

    server = new NodeDOSServer();
    server.namespace.mount("/", new MemoryDriver());
    await server.listen(port, "127.0.0.1");
    cleanups.push(() => server.close());

    // The client should reconnect on its own and serve requests again.
    await until(async () => client.isConnected());
    const r2 = await client.request({ type: "tstat", path: "/" });
    expect(r2.type).toBe("rstat");
  });

  it("stops reconnecting after a deliberate disconnect", async () => {
    const port = freshPort();
    const server = new NodeDOSServer();
    server.namespace.mount("/", new MemoryDriver());
    await server.listen(port, "127.0.0.1");
    cleanups.push(() => server.close());

    const client = new NodeDOSClient({
      reconnect: true,
      reconnectBaseMs: 25,
      reconnectMaxMs: 100,
    });
    await client.connect("127.0.0.1", port);

    client.disconnect();
    // Give a would-be reconnect loop time to fire.
    await new Promise((r) => setTimeout(r, 200));
    expect(client.isConnected()).toBe(false);
  });
});

describe("mount survives a remote restart", () => {
  it("returns rerror while the remote is down, then recovers", async () => {
    const portB = freshPort();
    const portA = freshPort();

    // Server B — the remote.
    let serverB = new NodeDOSServer();
    serverB.namespace.mount("/", new MemoryDriver());
    await serverB.listen(portB, "127.0.0.1");

    // Server A mounts B at /remote via a reconnecting client.
    const serverA = new NodeDOSServer();
    serverA.namespace.mount("/", new MemoryDriver());
    const mountClient = new NodeDOSClient({
      reconnect: true,
      reconnectBaseMs: 25,
      reconnectMaxMs: 100,
      requestTimeoutMs: 1000,
    });
    await mountClient.connect("127.0.0.1", portB);
    serverA.namespace.mount("/remote", new RemoteDriver(mountClient));
    await serverA.listen(portA, "127.0.0.1");
    cleanups.push(() => serverA.close());
    cleanups.push(() => mountClient.disconnect());

    const testClient = new NodeDOSClient();
    await testClient.connect("127.0.0.1", portA);
    cleanups.push(() => testClient.disconnect());

    // Write through the mount while everything is up.
    const w = await testClient.request({
      type: "twrite",
      path: "/remote/f.txt",
      offset: 0,
      data: Buffer.from("v1").toString("base64"),
    });
    expect(w.type).toBe("rwrite");

    // Crash B. Requests to /remote must come back as rerror, not hang.
    await serverB.close();
    await until(async () => !mountClient.isConnected());

    const down = await testClient.request({ type: "tstat", path: "/remote/f.txt" });
    expect(down.type).toBe("rerror");

    // Restart B; the mount client reconnects and the mount works again.
    serverB = new NodeDOSServer();
    serverB.namespace.mount("/", new MemoryDriver());
    await serverB.listen(portB, "127.0.0.1");
    cleanups.push(() => serverB.close());

    await until(async () => mountClient.isConnected());
    const up = await testClient.request({
      type: "twrite",
      path: "/remote/f.txt",
      offset: 0,
      data: Buffer.from("v2").toString("base64"),
    });
    expect(up.type).toBe("rwrite");
  });
});
