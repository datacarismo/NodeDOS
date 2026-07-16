import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Buffer } from "node:buffer";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import { PosixDriver } from "./posix";

describe("PosixDriver", () => {
  let root: string;
  let drv: PosixDriver;

  beforeEach(async () => {
    root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "nodedos-posix-"));
    drv = new PosixDriver(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("removes a file", async () => {
    await drv.write("/f.txt", 0, Buffer.from("x"));
    await drv.remove("/f.txt");
    await expect(drv.stat("/f.txt")).rejects.toThrow();
  });

  it("removes an empty directory", async () => {
    await drv.mkdir("/empty");
    await drv.remove("/empty");
    await expect(drv.stat("/empty")).rejects.toThrow();
  });

  it("refuses to remove a non-empty directory", async () => {
    await drv.mkdir("/full");
    await drv.write("/full/f.txt", 0, Buffer.from("x"));
    await expect(drv.remove("/full")).rejects.toThrow();
  });

  it("throws on remove of missing path", async () => {
    await expect(drv.remove("/missing")).rejects.toThrow();
  });

  it("renames a file", async () => {
    await drv.write("/old.txt", 0, Buffer.from("content"));
    await drv.rename("/old.txt", "/new.txt");
    await expect(drv.stat("/old.txt")).rejects.toThrow();
    const r = await drv.read("/new.txt", 0, 7);
    expect(r.toString()).toBe("content");
  });

  it("renames a directory with its children", async () => {
    await drv.mkdir("/src");
    await drv.write("/src/a.txt", 0, Buffer.from("a"));
    await drv.rename("/src", "/dst");
    const r = await drv.read("/dst/a.txt", 0, 1);
    expect(r.toString()).toBe("a");
    await expect(drv.stat("/src")).rejects.toThrow();
  });

  it("throws on rename of missing source", async () => {
    await expect(drv.rename("/nope", "/other")).rejects.toThrow();
  });

  it("never lets rename escape the root", async () => {
    await drv.write("/f.txt", 0, Buffer.from("x"));
    await drv.rename("/f.txt", "/../escape.txt").catch(() => {});
    const escaped = await fs
      .stat(nodePath.join(root, "..", "escape.txt"))
      .then(() => true)
      .catch(() => false);
    expect(escaped).toBe(false);
  });

  it("truncate shrinks a file", async () => {
    await drv.write("/t.txt", 0, Buffer.from("123456"));
    await drv.truncate("/t.txt", 3);
    const s = await drv.stat("/t.txt");
    expect(s.size).toBe(3);
    const r = await drv.read("/t.txt", 0, 10);
    expect(r.toString()).toBe("123");
  });

  it("truncate extends a file with zero bytes", async () => {
    await drv.write("/t.txt", 0, Buffer.from("ab"));
    await drv.truncate("/t.txt", 4);
    const r = await drv.read("/t.txt", 0, 4);
    expect(Array.from(r)).toEqual([0x61, 0x62, 0, 0]);
  });

  it("throws on truncate of a directory", async () => {
    await drv.mkdir("/dir");
    await expect(drv.truncate("/dir", 0)).rejects.toThrow();
  });
});
