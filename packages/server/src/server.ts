import * as net from "node:net";
import * as crypto from "node:crypto";
import { Transport } from "@nodedos/protocol";
import { Namespace } from "@nodedos/core";
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
  readonly namespace: Namespace;

  constructor(options: ServerOptions = {}) {
    const secret = options.secret;
    this.namespace = new Namespace();
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
        void handleMessage(this.namespace, transport, msg);
      });
      transport.on("error", (err: Error) => {
        process.stderr.write(`[nodedos] transport error: ${err.message}\n`);
        transport.destroy();
      });
    });
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
