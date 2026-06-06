import type { Driver } from "./filesystem";

interface MountEntry {
  prefix: string;
  driver: Driver;
}

export interface Resolved {
  driver: Driver;
  relativePath: string;
}

export class Namespace {
  private mounts: MountEntry[] = [];

  mount(prefix: string, driver: Driver): void {
    const key = normalize(prefix);
    this.unmount(key);
    this.mounts.push({ prefix: key, driver });
    // Longest prefix first so more-specific mounts shadow broader ones.
    this.mounts.sort((a, b) => b.prefix.length - a.prefix.length);
  }

  unmount(prefix: string): void {
    const key = normalize(prefix);
    this.mounts = this.mounts.filter((m) => m.prefix !== key);
  }

  resolve(path: string): Resolved {
    const p = normalize(path);
    for (const { prefix, driver } of this.mounts) {
      if (p === prefix) {
        return { driver, relativePath: "/" };
      }
      // Root mount ("/") matches every absolute path.
      if (prefix === "/" || p.startsWith(prefix + "/")) {
        const relativePath = prefix === "/" ? p : p.slice(prefix.length) || "/";
        return { driver, relativePath };
      }
    }
    throw new Error(`No mount covers path: ${path}`);
  }
}

function normalize(p: string): string {
  const s = ("/" + p).replace(/\/+/g, "/").replace(/\/$/, "");
  return s === "" ? "/" : s;
}
