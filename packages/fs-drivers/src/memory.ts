import { Buffer } from "node:buffer";
import * as nodePath from "node:path";
import type { Driver, Stat } from "@nodedos/core";

interface MemNode {
  isDir: boolean;
  content: Buffer;
  children: Map<string, MemNode>;
  mtime: number;
  mode: number;
}

function makeDir(): MemNode {
  return { isDir: true, content: Buffer.alloc(0), children: new Map(), mtime: Date.now(), mode: 0o755 };
}

function makeFile(): MemNode {
  return { isDir: false, content: Buffer.alloc(0), children: new Map(), mtime: Date.now(), mode: 0o644 };
}

export class MemoryDriver implements Driver {
  private root: MemNode = makeDir();

  private node(path: string): MemNode | undefined {
    const parts = path.split("/").filter(Boolean);
    let cur = this.root;
    for (const part of parts) {
      const next = cur.children.get(part);
      if (!next) return undefined;
      cur = next;
    }
    return cur;
  }

  private parentAndName(path: string): { parent: MemNode; name: string } {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error(`Invalid path: ${path}`);
    let cur = this.root;
    for (const part of parts) {
      const next = cur.children.get(part);
      if (!next) throw new Error(`No such file or directory: ${nodePath.dirname(path)}`);
      if (!next.isDir) throw new Error(`Not a directory: ${nodePath.dirname(path)}`);
      cur = next;
    }
    return { parent: cur, name };
  }

  private toStat(name: string, node: MemNode): Stat {
    return { name, isDir: node.isDir, size: node.content.length, mtime: node.mtime, mode: node.mode };
  }

  async stat(path: string): Promise<Stat> {
    if (path === "/") return this.toStat("/", this.root);
    const node = this.node(path);
    if (!node) throw new Error(`No such file or directory: ${path}`);
    return this.toStat(nodePath.basename(path), node);
  }

  async read(path: string, offset: number, count: number): Promise<Buffer> {
    const node = this.node(path);
    if (!node || node.isDir) throw new Error(`Not a file: ${path}`);
    return node.content.subarray(offset, offset + count);
  }

  async write(path: string, offset: number, data: Buffer): Promise<number> {
    let node = this.node(path);
    if (!node) {
      const { parent, name } = this.parentAndName(path);
      node = makeFile();
      parent.children.set(name, node);
    }
    if (node.isDir) throw new Error(`Is a directory: ${path}`);
    const end = offset + data.length;
    if (end > node.content.length) {
      const extended = Buffer.alloc(end);
      node.content.copy(extended);
      node.content = extended;
    }
    data.copy(node.content, offset);
    if (offset === 0) {
      node.content = node.content.subarray(0, end);
    }
    node.mtime = Date.now();
    return data.length;
  }

  async readdir(path: string): Promise<Stat[]> {
    const node = path === "/" ? this.root : this.node(path);
    if (!node?.isDir) throw new Error(`Not a directory: ${path}`);
    return Array.from(node.children.entries()).map(([name, child]) => this.toStat(name, child));
  }

  async mkdir(path: string): Promise<void> {
    const { parent, name } = this.parentAndName(path);
    if (parent.children.has(name)) throw new Error(`Already exists: ${path}`);
    parent.children.set(name, makeDir());
  }
}
