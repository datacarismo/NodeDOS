import { describe, it, expect, afterEach } from "vitest";
import { Buffer } from "node:buffer";
import { NodeDOSServer } from "@nodedos/server";
import type { RequestLogEvent, MountEvent } from "@nodedos/server";
import { NodeDOSClient } from "@nodedos/client";
import { MemoryDriver } from "@nodedos/fs-drivers";

let nextPort = 20000;
function freshPort(): number {
  return nextPort++;
}

async function until(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
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

async function startNode(port: number): Promise<NodeDOSServer> {
  const server = new NodeDOSServer();
  server.namespace.mount("/", new MemoryDriver());
  await server.listen(port, "127.0.0.1");
  cleanups.push(() => server.close());
  return server;
}

async function connect(port: number, opts: ConstructorParameters<typeof NodeDOSClient>[0] = {}): Promise<NodeDOSClient> {
  const client = new NodeDOSClient(opts);
  await client.connect("127.0.0.1", port);
  cleanups.push(() => client.disconnect());
  return client;
}

describe("server request lifecycle events", () => {
  it("emits a request event with type, path, duration, and ok for successful ops", async () => {
    const port = freshPort();
    const server = await startNode(port);
    const events: RequestLogEvent[] = [];
    server.on("request", (e: RequestLogEvent) => events.push(e));

    const client = await connect(port);
    await client.request({
      type: "twrite",
      path: "/f.txt",
      offset: 0,
      data: Buffer.from("x").toString("base64"),
    });
    await client.request({ type: "tstat", path: "/f.txt" });

    await until(() => events.length >= 2);
    const write = events.find((e) => e.type === "twrite");
    expect(write).toBeDefined();
    expect(write!.path).toBe("/f.txt");
    expect(write!.ok).toBe(true);
    expect(write!.ms).toBeGreaterThanOrEqual(0);

    const stat = events.find((e) => e.type === "tstat");
    expect(stat!.ok).toBe(true);
  });

  it("emits ok:false with the error message for failed ops", async () => {
    const port = freshPort();
    const server = await startNode(port);
    const events: RequestLogEvent[] = [];
    server.on("request", (e: RequestLogEvent) => events.push(e));

    const client = await connect(port);
    await client.request({ type: "tstat", path: "/does-not-exist" });

    await until(() => events.length >= 1);
    expect(events[0].ok).toBe(false);
    expect(events[0].error).toMatch(/no such file/i);
  });
});

describe("client connection state events", () => {
  it("emits connected, disconnected, and reconnecting across a server restart", async () => {
    const port = freshPort();
    let server = await startNode(port);

    const seen: string[] = [];
    const client = new NodeDOSClient({ reconnect: true, reconnectBaseMs: 25, reconnectMaxMs: 100 });
    client.on("connected", () => seen.push("connected"));
    client.on("disconnected", () => seen.push("disconnected"));
    client.on("reconnecting", () => seen.push("reconnecting"));
    await client.connect("127.0.0.1", port);
    cleanups.push(() => client.disconnect());

    await server.close();
    await until(() => seen.includes("disconnected") && seen.includes("reconnecting"));

    server = await startNode(port);
    await until(() => seen.filter((s) => s === "connected").length >= 2);

    expect(seen[0]).toBe("connected");
    expect(seen).toContain("disconnected");
    expect(seen).toContain("reconnecting");
  });
});

describe("mount health events", () => {
  it("reports the remote dropping and coming back on a hot mount", async () => {
    const portA = freshPort();
    const portB = freshPort();
    const serverA = await startNode(portA);
    let serverB = await startNode(portB);

    const events: MountEvent[] = [];
    serverA.on("mount", (e: MountEvent) => events.push(e));

    const client = await connect(portA);
    const m = await client.request({ type: "tmount", prefix: "/remote", host: "127.0.0.1", port: portB });
    expect(m.type).toBe("rmount");

    await until(() => events.some((e) => e.prefix === "/remote" && e.state === "connected"));

    await serverB.close();
    await until(() => events.some((e) => e.prefix === "/remote" && e.state === "disconnected"));

    serverB = await startNode(portB);
    await until(() => events.filter((e) => e.state === "connected").length >= 2);
  });
});
