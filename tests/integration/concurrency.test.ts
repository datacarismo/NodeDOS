import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Buffer } from "node:buffer";
import { NodeDOSServer } from "@nodedos/server";
import { NodeDOSClient } from "@nodedos/client";
import { MemoryDriver } from "@nodedos/fs-drivers";

const PORT_A = 20100;
const PORT_B = 20101;

let serverA: NodeDOSServer;
let serverB: NodeDOSServer;
let mountClient: NodeDOSClient;

beforeAll(async () => {
  serverB = new NodeDOSServer();
  serverB.namespace.mount("/", new MemoryDriver());
  await serverB.listen(PORT_B, "127.0.0.1");

  serverA = new NodeDOSServer();
  serverA.namespace.mount("/", new MemoryDriver());
  mountClient = new NodeDOSClient();
  await mountClient.connect("127.0.0.1", PORT_B);
  const { RemoteDriver } = await import("@nodedos/client");
  serverA.namespace.mount("/remote", new RemoteDriver(mountClient));
  await serverA.listen(PORT_A, "127.0.0.1");
});

afterAll(async () => {
  mountClient.disconnect();
  await serverA.close();
  await serverB.close();
});

describe("concurrent client access", () => {
  it("20 clients working simultaneously see no cross-talk", async () => {
    const clients = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const c = new NodeDOSClient();
        await c.connect("127.0.0.1", PORT_A);
        return c;
      }),
    );

    try {
      await Promise.all(
        clients.map(async (c, i) => {
          const content = `client-${i}-data`;
          const w = await c.request({
            type: "twrite",
            path: `/c${i}.txt`,
            offset: 0,
            data: Buffer.from(content).toString("base64"),
          });
          expect(w.type).toBe("rwrite");
          const r = await c.request({ type: "tread", path: `/c${i}.txt`, offset: 0, count: 100 });
          expect(r.type).toBe("rread");
          if (r.type === "rread") {
            expect(Buffer.from(r.data, "base64").toString()).toBe(content);
          }
        }),
      );
    } finally {
      for (const c of clients) c.disconnect();
    }
  });

  it("50 interleaved in-flight requests on one connection resolve to the right tags", async () => {
    const c = new NodeDOSClient();
    await c.connect("127.0.0.1", PORT_A);
    try {
      // Seed 50 files with distinct contents.
      await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          c.request({
            type: "twrite",
            path: `/tag${i}.txt`,
            offset: 0,
            data: Buffer.from(`payload-${i}`).toString("base64"),
          }),
        ),
      );
      // Fire all 50 reads without awaiting in between.
      const reads = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          c.request({ type: "tread", path: `/tag${i}.txt`, offset: 0, count: 100 }),
        ),
      );
      reads.forEach((r, i) => {
        expect(r.type).toBe("rread");
        if (r.type === "rread") {
          expect(Buffer.from(r.data, "base64").toString()).toBe(`payload-${i}`);
        }
      });
    } finally {
      c.disconnect();
    }
  });

  it("concurrent mkdir of the same directory yields exactly one success", async () => {
    const c = new NodeDOSClient();
    await c.connect("127.0.0.1", PORT_A);
    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => c.request({ type: "tmkdir", path: "/contested" })),
      );
      const wins = results.filter((r) => r.type === "rmkdir").length;
      const errors = results.filter((r) => r.type === "rerror").length;
      expect(wins).toBe(1);
      expect(errors).toBe(9);
    } finally {
      c.disconnect();
    }
  });

  it("concurrent operations through a mount stay correct", async () => {
    const c = new NodeDOSClient();
    await c.connect("127.0.0.1", PORT_A);
    try {
      await Promise.all(
        Array.from({ length: 30 }, async (_, i) => {
          const content = `remote-${i}`;
          await c.request({
            type: "twrite",
            path: `/remote/m${i}.txt`,
            offset: 0,
            data: Buffer.from(content).toString("base64"),
          });
          const r = await c.request({ type: "tread", path: `/remote/m${i}.txt`, offset: 0, count: 100 });
          expect(r.type).toBe("rread");
          if (r.type === "rread") {
            expect(Buffer.from(r.data, "base64").toString()).toBe(content);
          }
        }),
      );
    } finally {
      c.disconnect();
    }
  });
});
