import * as net from "node:net";
import { Transport } from "@nodedos/protocol";
import type { NodeMessage, TMessage, RMessage } from "@nodedos/protocol";

interface Pending {
  resolve: (msg: RMessage) => void;
  reject: (err: Error) => void;
}

// Distributive conditional — must be a generic type parameter in the check position
// so that the conditional distributes over each union member independently.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type TPayload = DistributiveOmit<TMessage, "tag">;

export class NodeDOSClient {
  private transport!: Transport;
  private pending = new Map<number, Pending>();
  private tagCounter = 0;

  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => resolve());
      socket.once("error", reject);
      this.transport = new Transport(socket);
      this.transport.on("message", (msg: NodeMessage) => {
        const r = msg as RMessage;
        const p = this.pending.get(r.tag);
        if (p) {
          this.pending.delete(r.tag);
          p.resolve(r);
        }
      });
      this.transport.on("close", () => {
        for (const { reject: r } of this.pending.values()) r(new Error("Connection closed"));
        this.pending.clear();
      });
    });
  }

  request(msg: TPayload): Promise<RMessage> {
    return new Promise((resolve, reject) => {
      const tag = ++this.tagCounter;
      this.pending.set(tag, { resolve, reject });
      this.transport.send({ ...msg, tag } as NodeMessage);
    });
  }

  disconnect(): void {
    this.transport.destroy();
  }
}
