import { describe, it, expect, afterEach } from "vitest";
import { Buffer } from "node:buffer";
import { NodeDOSServer } from "@nodedos/server";
import { NodeDOSClient } from "@nodedos/client";
import { MemoryDriver } from "@nodedos/fs-drivers";

let nextPort = 19900;
function freshPort(): number {
  return nextPort++;
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

async function startNode(port: number, secret?: string): Promise<NodeDOSServer> {
  const server = new NodeDOSServer(secret === undefined ? {} : { secret });
  server.namespace.mount("/", new MemoryDriver());
  await server.listen(port, "127.0.0.1");
  cleanups.push(() => server.close());
  return server;
}

async function connect(port: number, secret?: string): Promise<NodeDOSClient> {
  const client = new NodeDOSClient(secret === undefined ? {} : { secret });
  await client.connect("127.0.0.1", port);
  cleanups.push(() => client.disconnect());
  return client;
}

async function seed(port: number, path: string, content: string, secret?: string): Promise<void> {
  const c = await connect(port, secret);
  await c.request({ type: "twrite", path, offset: 0, data: Buffer.from(content).toString("base64") });
}

describe("hot mount/unmount", () => {
  it("attaches a remote node at runtime via tmount", async () => {
    const portA = freshPort();
    const portB = freshPort();
    await startNode(portA);
    await startNode(portB);
    await seed(portB, "/data.txt", "on B");

    const client = await connect(portA);
    const m = await client.request({ type: "tmount", prefix: "/remote", host: "127.0.0.1", port: portB });
    expect(m.type).toBe("rmount");

    const r = await client.request({ type: "tread", path: "/remote/data.txt", offset: 0, count: 4 });
    expect(r.type).toBe("rread");
    if (r.type === "rread") expect(Buffer.from(r.data, "base64").toString()).toBe("on B");
  });

  it("detaches a mount via tunmount", async () => {
    const portA = freshPort();
    const portB = freshPort();
    await startNode(portA);
    await startNode(portB);
    await seed(portB, "/only-on-b.txt", "b");

    const client = await connect(portA);
    await client.request({ type: "tmount", prefix: "/remote", host: "127.0.0.1", port: portB });
    const visible = await client.request({ type: "tstat", path: "/remote/only-on-b.txt" });
    expect(visible.type).toBe("rstat");

    const u = await client.request({ type: "tunmount", prefix: "/remote" });
    expect(u.type).toBe("runmount");

    // The path now falls through to A's root driver, where the file doesn't exist.
    const r = await client.request({ type: "tstat", path: "/remote/only-on-b.txt" });
    expect(r.type).toBe("rerror");
  });

  it("rejects tunmount of a prefix that is not a remote mount", async () => {
    const portA = freshPort();
    await startNode(portA);

    const client = await connect(portA);
    const missing = await client.request({ type: "tunmount", prefix: "/nope" });
    expect(missing.type).toBe("rerror");

    // The local root is not a remote mount and must be protected.
    const root = await client.request({ type: "tunmount", prefix: "/" });
    expect(root.type).toBe("rerror");
  });

  it("rejects tmount at the root prefix", async () => {
    const portA = freshPort();
    const portB = freshPort();
    await startNode(portA);
    await startNode(portB);

    const client = await connect(portA);
    const m = await client.request({ type: "tmount", prefix: "/", host: "127.0.0.1", port: portB });
    expect(m.type).toBe("rerror");
  });

  it("returns rerror when the mount target is unreachable", async () => {
    const portA = freshPort();
    const dead = freshPort(); // nothing listens here
    await startNode(portA);

    const client = await connect(portA);
    const m = await client.request({ type: "tmount", prefix: "/remote", host: "127.0.0.1", port: dead });
    expect(m.type).toBe("rerror");
  });

  it("re-mounting a prefix replaces the previous mount", async () => {
    const portA = freshPort();
    const portB = freshPort();
    const portC = freshPort();
    await startNode(portA);
    await startNode(portB);
    await startNode(portC);
    await seed(portB, "/who.txt", "B");
    await seed(portC, "/who.txt", "C");

    const client = await connect(portA);
    await client.request({ type: "tmount", prefix: "/remote", host: "127.0.0.1", port: portB });
    await client.request({ type: "tmount", prefix: "/remote", host: "127.0.0.1", port: portC });

    const r = await client.request({ type: "tread", path: "/remote/who.txt", offset: 0, count: 1 });
    expect(r.type).toBe("rread");
    if (r.type === "rread") expect(Buffer.from(r.data, "base64").toString()).toBe("C");
  });

  it("uses the server's own secret for the remote by default", async () => {
    const portA = freshPort();
    const portB = freshPort();
    await startNode(portA, "s3cret");
    await startNode(portB, "s3cret");
    await seed(portB, "/sec.txt", "locked", "s3cret");

    const client = await connect(portA, "s3cret");
    const m = await client.request({ type: "tmount", prefix: "/remote", host: "127.0.0.1", port: portB });
    expect(m.type).toBe("rmount");

    const r = await client.request({ type: "tread", path: "/remote/sec.txt", offset: 0, count: 6 });
    expect(r.type).toBe("rread");
    if (r.type === "rread") expect(Buffer.from(r.data, "base64").toString()).toBe("locked");
  });
});
