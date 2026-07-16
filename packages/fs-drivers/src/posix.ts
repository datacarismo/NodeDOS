import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import { Buffer } from "node:buffer";
import type { Driver, Stat } from "@nodedos/core";

export class PosixDriver implements Driver {
  constructor(private root: string) {}

  private resolveRaw(path: string): string {
    const safe = nodePath.normalize("/" + path);
    return nodePath.join(this.root, safe);
  }

  private async resolve(path: string): Promise<string> {
    const abs = this.resolveRaw(path);
    // Guard against symlinks pointing outside the chroot root.
    const rootReal = await fs.realpath(this.root);
    let real: string;
    try {
      real = await fs.realpath(abs);
    } catch {
      // Path doesn't exist yet (e.g. a write target) — check the parent instead.
      real = nodePath.join(
        await fs.realpath(nodePath.dirname(abs)).catch(() => nodePath.dirname(abs)),
        nodePath.basename(abs),
      );
    }
    if (real !== rootReal && !real.startsWith(rootReal + nodePath.sep)) {
      throw new Error(`Permission denied: path escapes chroot`);
    }
    return abs;
  }

  async stat(path: string): Promise<Stat> {
    const abs = await this.resolve(path);
    const s = await fs.stat(abs);
    return {
      name: nodePath.basename(abs) || "/",
      isDir: s.isDirectory(),
      size: s.size,
      mtime: s.mtimeMs,
      mode: s.mode,
    };
  }

  async read(path: string, offset: number, count: number): Promise<Buffer> {
    const abs = await this.resolve(path);
    const fh = await fs.open(abs, "r");
    try {
      const buf = Buffer.alloc(count);
      const { bytesRead } = await fh.read(buf, 0, count, offset);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }

  async write(path: string, offset: number, data: Buffer): Promise<number> {
    const abs = await this.resolve(path);
    // Create file if it doesn't exist; open for random-access write otherwise.
    let fh: fs.FileHandle;
    try {
      fh = await fs.open(abs, "r+");
    } catch {
      await fs.writeFile(abs, Buffer.alloc(0));
      fh = await fs.open(abs, "r+");
    }
    try {
      const { bytesWritten } = await fh.write(data, 0, data.length, offset);
      if (offset === 0) {
        await fh.truncate(data.length);
      }
      return bytesWritten;
    } finally {
      await fh.close();
    }
  }

  async readdir(path: string): Promise<Stat[]> {
    const abs = await this.resolve(path);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    return Promise.all(
      entries.map(async (e) => {
        const s = await fs.stat(nodePath.join(abs, e.name));
        return {
          name: e.name,
          isDir: e.isDirectory(),
          size: s.size,
          mtime: s.mtimeMs,
          mode: s.mode,
        };
      }),
    );
  }

  async mkdir(path: string): Promise<void> {
    await fs.mkdir(await this.resolve(path));
  }

  async remove(path: string): Promise<void> {
    const abs = await this.resolve(path);
    const s = await fs.stat(abs);
    if (s.isDirectory()) await fs.rmdir(abs);
    else await fs.unlink(abs);
  }

  async rename(from: string, to: string): Promise<void> {
    const absFrom = await this.resolve(from);
    const absTo = await this.resolve(to);
    await fs.rename(absFrom, absTo);
  }

  async truncate(path: string, size: number): Promise<void> {
    const abs = await this.resolve(path);
    const s = await fs.stat(abs);
    if (s.isDirectory()) throw new Error(`Is a directory: ${path}`);
    await fs.truncate(abs, size);
  }
}
