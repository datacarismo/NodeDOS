import { describe, it, expect, beforeEach } from "vitest";
import { Namespace } from "./namespace";
import type { Driver, Stat } from "./filesystem";

function stubDriver(name: string): Driver {
  return {
    stat: async () => ({ name, isDir: false, size: 0, mtime: 0, mode: 0 }),
    read: async () => Buffer.alloc(0),
    write: async () => 0,
    readdir: async () => [],
    mkdir: async () => {},
  };
}

describe("Namespace", () => {
  let ns: Namespace;

  beforeEach(() => { ns = new Namespace(); });

  it("resolves a path under the root mount", () => {
    const d = stubDriver("root");
    ns.mount("/", d);
    const r = ns.resolve("/foo/bar");
    expect(r.driver).toBe(d);
    expect(r.relativePath).toBe("/foo/bar");
  });

  it("root mount resolves '/' itself to '/'", () => {
    const d = stubDriver("root");
    ns.mount("/", d);
    expect(ns.resolve("/").relativePath).toBe("/");
  });

  it("longer prefix shadows root mount", () => {
    const root = stubDriver("root");
    const remote = stubDriver("remote");
    ns.mount("/", root);
    ns.mount("/remote", remote);
    const r = ns.resolve("/remote/data.txt");
    expect(r.driver).toBe(remote);
    expect(r.relativePath).toBe("/data.txt");
  });

  it("exact prefix match returns relativePath '/'", () => {
    const d = stubDriver("x");
    ns.mount("/mnt", d);
    expect(ns.resolve("/mnt").relativePath).toBe("/");
  });

  it("does not match a prefix that is a substring but not a path boundary", () => {
    const d = stubDriver("x");
    ns.mount("/foo", d);
    // /foobar should NOT match /foo
    ns.mount("/", stubDriver("root"));
    const r = ns.resolve("/foobar");
    expect(r.driver).not.toBe(d);
  });

  it("throws when no mount covers the path", () => {
    expect(() => ns.resolve("/anything")).toThrow();
  });

  it("unmount removes the mount", () => {
    const d = stubDriver("x");
    ns.mount("/mnt", d);
    ns.unmount("/mnt");
    expect(() => ns.resolve("/mnt")).toThrow();
  });
});
