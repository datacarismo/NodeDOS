import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Buffer } from "node:buffer";
import { NodeDOSServer } from "@nodedos/server";
import { NodeDOSClient, RemoteDriver } from "@nodedos/client";
import { MemoryDriver } from "@nodedos/fs-drivers";

// Smoke checks, not benchmarks: bounds are deliberately generous so they
// only trip on pathological regressions (e.g. an accidental sync wait or
// per-request reconnect), not on slow CI machines.

const PORT_A = 20200;
const PORT_B = 20201;

let serverA: NodeDOSServer;
let serverB: NodeDOSServer;
let mountClient: NodeDOSClient;
let client: NodeDOSClient;

beforeAll(async () => {
  serverB = new NodeDOSServer();
  serverB.namespace.mount("/", new MemoryDriver());
  await serverB.listen(PORT_B, "127.0.0.1");

  serverA = new NodeDOSServer();
  serverA.namespace.mount("/", new MemoryDriver());
  mountClient = new NodeDOSClient();
  await mountClient.connect("127.0.0.1", PORT_B);
  serverA.namespace.mount("/remote", new RemoteDriver(mountClient));
  await serverA.listen(PORT_A, "127.0.0.1");

  client = new NodeDOSClient();
  await client.connect("127.0.0.1", PORT_A);
});

afterAll(async () => {
  client.disconnect();
  mountClient.disconnect();
  await serverA.close();
  await serverB.close();
});

describe("performance smoke checks", () => {
  it("500 sequential write/read round-trips complete in bounded time", async () => {
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      await client.request({
        type: "twrite",
        path: "/seq.txt",
        offset: 0,
        data: Buffer.from(`iteration ${i}`).toString("base64"),
      });
      const r = await client.request({ type: "tread", path: "/seq.txt", offset: 0, count: 64 });
      expect(r.type).toBe("rread");
    }
    const elapsed = performance.now() - start;
    console.log(`500 local round-trip pairs: ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(15_000);
  }, 20_000);

  it("200 sequential round-trips through a two-node chain complete in bounded time", async () => {
    const start = performance.now();
    for (let i = 0; i < 200; i++) {
      await client.request({
        type: "twrite",
        path: "/remote/seq.txt",
        offset: 0,
        data: Buffer.from(`hop ${i}`).toString("base64"),
      });
      const r = await client.request({ type: "tread", path: "/remote/seq.txt", offset: 0, count: 64 });
      expect(r.type).toBe("rread");
    }
    const elapsed = performance.now() - start;
    console.log(`200 chained round-trip pairs: ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(15_000);
  }, 20_000);

  it("100 concurrent 64KB reads return intact in bounded time", async () => {
    const blob = Buffer.alloc(64 * 1024, 0xab);
    await client.request({
      type: "twrite",
      path: "/blob.bin",
      offset: 0,
      data: blob.toString("base64"),
    });

    const start = performance.now();
    const reads = await Promise.all(
      Array.from({ length: 100 }, () =>
        client.request({ type: "tread", path: "/blob.bin", offset: 0, count: blob.length }),
      ),
    );
    const elapsed = performance.now() - start;
    console.log(`100 concurrent 64KB reads: ${elapsed.toFixed(0)}ms`);

    for (const r of reads) {
      expect(r.type).toBe("rread");
      if (r.type === "rread") {
        expect(Buffer.from(r.data, "base64").equals(blob)).toBe(true);
      }
    }
    expect(elapsed).toBeLessThan(15_000);
  }, 20_000);
});
