import * as net from "node:net";
import { Transport } from "@nodedos/protocol";
import { Namespace } from "@nodedos/core";
import { handleMessage } from "./handler";

export class NodeDOSServer {
  private server: net.Server;
  private sockets = new Set<net.Socket>();
  readonly namespace: Namespace;

  constructor() {
    this.namespace = new Namespace();
    this.server = net.createServer((socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      const transport = new Transport(socket);
      transport.on("message", (msg) => {
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
