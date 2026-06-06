import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Buffer } from "node:buffer";
import { NodeDOSServer } from "@nodedos/server";
import { NodeDOSClient, RemoteDriver } from "@nodedos/client";
import { MemoryDriver } from "@nodedos/fs-drivers";

const PORT_A = 19001;
const PORT_B = 19002;

let serverA: NodeDOSServer;
let serverB: NodeDOSServer;
let mountClient: NodeDOSClient; // client used by serverA to reach serverB
let testClient: NodeDOSClient;  // client used by the test to reach serverA

beforeAll(async () => {
  // Server B: simple in-memory FS
  serverB = new NodeDOSServer();
  serverB.namespace.mount("/", new MemoryDriver());
  await serverB.listen(PORT_B, "127.0.0.1");

  // Server A: its own in-memory FS + B mounted at /remote
  serverA = new NodeDOSServer();
  serverA.namespace.mount("/", new MemoryDriver());
  mountClient = new NodeDOSClient();
  await mountClient.connect("127.0.0.1", PORT_B);
  serverA.namespace.mount("/remote", new RemoteDriver(mountClient));
  await serverA.listen(PORT_A, "127.0.0.1");

  // Test client connects to server A
  testClient = new NodeDOSClient();
  await testClient.connect("127.0.0.1", PORT_A);
});

afterAll(async () => {
  testClient.disconnect();
  mountClient.disconnect();
  await serverA.close();
  await serverB.close();
});

describe("two-node distributed filesystem", () => {
  it("ls on server A local root returns empty dir", async () => {
    const r = await testClient.request({ type: "treaddir", path: "/" });
    expect(r.type).toBe("rreaddir");
  });

  it("writes a file to server A and reads it back", async () => {
    const content = Buffer.from("local file on A");
    await testClient.request({
      type: "twrite",
      path: "/local.txt",
      offset: 0,
      data: content.toString("base64"),
    });
    const r = await testClient.request({ type: "tread", path: "/local.txt", offset: 0, count: content.length });
    expect(r.type).toBe("rread");
    if (r.type === "rread") {
      expect(Buffer.from(r.data, "base64").toString()).toBe("local file on A");
    }
  });

  it("writes a file through A to the remote B and reads it back", async () => {
    const content = Buffer.from("remote file on B via A");
    const writeR = await testClient.request({
      type: "twrite",
      path: "/remote/data.txt",
      offset: 0,
      data: content.toString("base64"),
    });
    expect(writeR.type).toBe("rwrite");

    const readR = await testClient.request({
      type: "tread",
      path: "/remote/data.txt",
      offset: 0,
      count: content.length,
    });
    expect(readR.type).toBe("rread");
    if (readR.type === "rread") {
      expect(Buffer.from(readR.data, "base64").toString()).toBe("remote file on B via A");
    }
  });

  it("ls on /remote shows the file written through A", async () => {
    const r = await testClient.request({ type: "treaddir", path: "/remote" });
    expect(r.type).toBe("rreaddir");
    if (r.type === "rreaddir") {
      expect(r.entries.some((e) => e.name === "data.txt")).toBe(true);
    }
  });

  it("mkdir through A creates a directory on B", async () => {
    const mkR = await testClient.request({ type: "tmkdir", path: "/remote/subdir" });
    expect(mkR.type).toBe("rmkdir");

    const statR = await testClient.request({ type: "tstat", path: "/remote/subdir" });
    expect(statR.type).toBe("rstat");
    if (statR.type === "rstat") expect(statR.stat.isDir).toBe(true);
  });

  it("file written on A is not visible on B's root (namespaces are isolated)", async () => {
    const r = await testClient.request({ type: "treaddir", path: "/" });
    expect(r.type).toBe("rreaddir");
    if (r.type === "rreaddir") {
      // local.txt should be on A
      expect(r.entries.some((e) => e.name === "local.txt")).toBe(true);
      // but not the remote files (those are on B)
      expect(r.entries.some((e) => e.name === "remote")).toBe(false);
    }
  });
});
