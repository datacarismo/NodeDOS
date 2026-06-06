import * as net from "node:net";
import { Transport } from "@nodedos/protocol";
import { Namespace } from "@nodedos/core";
import { handleMessage } from "./handler";

export class NodeDOSServer {
  private server: net.Server;
  readonly namespace: Namespace;

  constructor() {
    this.namespace = new Namespace();
    this.server = net.createServer((socket) => {
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
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
