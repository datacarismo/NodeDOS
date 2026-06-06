import { Buffer } from "node:buffer";
import type { Driver, Stat } from "@nodedos/core";
import type { RMessage } from "@nodedos/protocol";
import type { NodeDOSClient } from "./client";

function assertOk(resp: RMessage): void {
  if (resp.type === "rerror") throw new Error(resp.ename);
}

export class RemoteDriver implements Driver {
  constructor(private client: NodeDOSClient) {}

  async stat(path: string): Promise<Stat> {
    const r = await this.client.request({ type: "tstat", path });
    assertOk(r);
    if (r.type !== "rstat") throw new Error(`Unexpected: ${r.type}`);
    return r.stat;
  }

  async read(path: string, offset: number, count: number): Promise<Buffer> {
    const r = await this.client.request({ type: "tread", path, offset, count });
    assertOk(r);
    if (r.type !== "rread") throw new Error(`Unexpected: ${r.type}`);
    return Buffer.from(r.data, "base64");
  }

  async write(path: string, offset: number, data: Buffer): Promise<number> {
    const r = await this.client.request({ type: "twrite", path, offset, data: data.toString("base64") });
    assertOk(r);
    if (r.type !== "rwrite") throw new Error(`Unexpected: ${r.type}`);
    return r.count;
  }

  async readdir(path: string): Promise<Stat[]> {
    const r = await this.client.request({ type: "treaddir", path });
    assertOk(r);
    if (r.type !== "rreaddir") throw new Error(`Unexpected: ${r.type}`);
    return r.entries;
  }

  async mkdir(path: string): Promise<void> {
    const r = await this.client.request({ type: "tmkdir", path });
    assertOk(r);
  }
}
