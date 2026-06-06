import { describe, it, expect, beforeEach } from "vitest";
import { Buffer } from "node:buffer";
import { MemoryDriver } from "./memory";

describe("MemoryDriver", () => {
  let drv: MemoryDriver;

  beforeEach(() => { drv = new MemoryDriver(); });

  it("stats the root directory", async () => {
    const s = await drv.stat("/");
    expect(s.isDir).toBe(true);
  });

  it("creates and stats a directory", async () => {
    await drv.mkdir("/docs");
    const s = await drv.stat("/docs");
    expect(s.isDir).toBe(true);
    expect(s.name).toBe("docs");
  });

  it("writes and reads a file", async () => {
    const data = Buffer.from("hello world");
    await drv.write("/hello.txt", 0, data);
    const result = await drv.read("/hello.txt", 0, data.length);
    expect(result.toString()).toBe("hello world");
  });

  it("reads a slice of a file", async () => {
    await drv.write("/data.bin", 0, Buffer.from("abcdef"));
    const slice = await drv.read("/data.bin", 2, 3);
    expect(slice.toString()).toBe("cde");
  });

  it("overwrites existing content at an offset", async () => {
    await drv.write("/f.txt", 0, Buffer.from("aaaaaa"));
    await drv.write("/f.txt", 2, Buffer.from("BB"));
    const r = await drv.read("/f.txt", 0, 6);
    expect(r.toString()).toBe("aaBBaa");
  });

  it("readdir lists children", async () => {
    await drv.mkdir("/dir");
    await drv.write("/dir/a.txt", 0, Buffer.from("a"));
    await drv.write("/dir/b.txt", 0, Buffer.from("b"));
    const entries = await drv.readdir("/dir");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["a.txt", "b.txt"]);
  });

  it("stat tracks file size", async () => {
    await drv.write("/big.txt", 0, Buffer.from("12345"));
    const s = await drv.stat("/big.txt");
    expect(s.size).toBe(5);
  });

  it("throws on stat of missing path", async () => {
    await expect(drv.stat("/missing")).rejects.toThrow();
  });

  it("throws on mkdir for existing path", async () => {
    await drv.mkdir("/exists");
    await expect(drv.mkdir("/exists")).rejects.toThrow();
  });
});
