import { describe, it, expect, afterEach } from "vitest";
import { NodeDOSServer } from "@nodedos/server";
import { NodeDOSClient } from "@nodedos/client";
import { MemoryDriver } from "@nodedos/fs-drivers";

let nextPort = 19700;
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

async function securedServer(port: number, secret: string): Promise<NodeDOSServer> {
  const server = new NodeDOSServer({ secret });
  server.namespace.mount("/", new MemoryDriver());
  await server.listen(port, "127.0.0.1");
  cleanups.push(() => server.close());
  return server;
}

describe("attach-time authentication", () => {
  it("rejects filesystem requests from unauthenticated connections", async () => {
    const port = freshPort();
    await securedServer(port, "s3cret");

    const client = new NodeDOSClient(); // no secret configured
    await client.connect("127.0.0.1", port);
    cleanups.push(() => client.disconnect());

    const r = await client.request({ type: "tstat", path: "/" });
    expect(r.type).toBe("rerror");
    if (r.type === "rerror") expect(r.ename).toMatch(/authentication required/i);
  });

  it("rejects a wrong secret at connect time", async () => {
    const port = freshPort();
    await securedServer(port, "s3cret");

    const client = new NodeDOSClient({ secret: "wrong" });
    cleanups.push(() => client.disconnect());
    await expect(client.connect("127.0.0.1", port)).rejects.toThrow(/authentication failed/i);
    expect(client.isConnected()).toBe(false);
  });

  it("serves requests normally after a successful handshake", async () => {
    const port = freshPort();
    await securedServer(port, "s3cret");

    const client = new NodeDOSClient({ secret: "s3cret" });
    await client.connect("127.0.0.1", port);
    cleanups.push(() => client.disconnect());

    expect(client.isConnected()).toBe(true);
    const r = await client.request({ type: "tstat", path: "/" });
    expect(r.type).toBe("rstat");
  });

  it("keeps zero-config behavior when the server has no secret", async () => {
    const port = freshPort();
    const server = new NodeDOSServer();
    server.namespace.mount("/", new MemoryDriver());
    await server.listen(port, "127.0.0.1");
    cleanups.push(() => server.close());

    const plain = new NodeDOSClient();
    await plain.connect("127.0.0.1", port);
    cleanups.push(() => plain.disconnect());
    const r = await plain.request({ type: "tstat", path: "/" });
    expect(r.type).toBe("rstat");

    // A client that offers a secret anyway must still work.
    const eager = new NodeDOSClient({ secret: "anything" });
    await eager.connect("127.0.0.1", port);
    cleanups.push(() => eager.disconnect());
    const r2 = await eager.request({ type: "tstat", path: "/" });
    expect(r2.type).toBe("rstat");
  });

  it("re-authenticates automatically after a reconnect", async () => {
    const port = freshPort();
    let server = await securedServer(port, "s3cret");

    const client = new NodeDOSClient({
      secret: "s3cret",
      reconnect: true,
      reconnectBaseMs: 25,
      reconnectMaxMs: 100,
    });
    await client.connect("127.0.0.1", port);
    cleanups.push(() => client.disconnect());

    const r1 = await client.request({ type: "tstat", path: "/" });
    expect(r1.type).toBe("rstat");

    await server.close();
    await until(async () => !client.isConnected());

    server = await securedServer(port, "s3cret");

    await until(async () => client.isConnected());
    const r2 = await client.request({ type: "tstat", path: "/" });
    expect(r2.type).toBe("rstat");
  });
});
