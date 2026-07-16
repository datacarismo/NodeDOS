import * as net from "node:net";
import * as crypto from "node:crypto";
import { Transport } from "@nodedos/protocol";
import type { TMountMsg, TUnmountMsg } from "@nodedos/protocol";
import { Namespace } from "@nodedos/core";
import { MountManager } from "@nodedos/client";
import { handleMessage } from "./handler";

export interface ServerOptions {
  /** Require clients to authenticate with this shared secret before any other request. */
  secret?: string;
}

function secretsMatch(offered: string, expected: string): boolean {
  // Hash both sides so timingSafeEqual gets equal-length inputs.
  const a = crypto.createHash("sha256").update(offered).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export class NodeDOSServer {
  private server: net.Server;
  private sockets = new Set<net.Socket>();
  private secret?: string;
  readonly namespace: Namespace;
  readonly mounts: MountManager;

  constructor(options: ServerOptions = {}) {
    const secret = options.secret;
    this.secret = secret;
    this.namespace = new Namespace();
    this.mounts = new MountManager(this.namespace);
    this.server = net.createServer((socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      const transport = new Transport(socket);
      let authenticated = false;
      transport.on("message", (msg) => {
        if (msg.type === "tauth") {
          if (secret === undefined || secretsMatch(String(msg.secret), secret)) {
            authenticated = true;
            transport.send({ type: "rauth", tag: msg.tag });
          } else {
            transport.send({ type: "rerror", tag: msg.tag, ename: "Authentication failed" });
          }
          return;
        }
        if (secret !== undefined && !authenticated) {
          transport.send({ type: "rerror", tag: msg.tag, ename: "Authentication required" });
          return;
        }
        if (msg.type === "tmount") {
          void this.handleMount(transport, msg);
          return;
        }
        if (msg.type === "tunmount") {
          this.handleUnmount(transport, msg);
          return;
        }
        void handleMessage(this.namespace, transport, msg);
      });
      transport.on("error", (err: Error) => {
        process.stderr.write(`[nodedos] transport error: ${err.message}\n`);
        transport.destroy();
      });
    });
  }

  private async handleMount(transport: Transport, msg: TMountMsg): Promise<void> {
    try {
      if (msg.prefix === "/" || !msg.prefix.startsWith("/")) {
        throw new Error(`Invalid mount prefix: ${msg.prefix}`);
      }
      await this.mounts.mountRemote(msg.prefix, msg.host, msg.port, {
        reconnect: true,
        requestTimeoutMs: 10_000,
        secret: msg.secret ?? this.secret,
      });
      transport.send({ type: "rmount", tag: msg.tag });
    } catch (err) {
      const ename = err instanceof Error ? err.message : String(err);
      transport.send({ type: "rerror", tag: msg.tag, ename });
    }
  }

  private handleUnmount(transport: Transport, msg: TUnmountMsg): void {
    try {
      this.mounts.unmountRemote(msg.prefix);
      transport.send({ type: "runmount", tag: msg.tag });
    } catch (err) {
      const ename = err instanceof Error ? err.message : String(err);
      transport.send({ type: "rerror", tag: msg.tag, ename });
    }
  }

  listen(port: number, host = "0.0.0.0"): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port, host, () => resolve());
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Sever live connections so close() resolves promptly instead of
      // waiting for every client to hang up.
      for (const socket of this.sockets) socket.destroy();
      this.sockets.clear();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
