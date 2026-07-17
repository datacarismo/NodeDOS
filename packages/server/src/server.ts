import * as net from "node:net";
import { EventEmitter } from "node:events";
import { Transport } from "@nodedos/protocol";
import type { NodeMessage, TMountMsg, TUnmountMsg } from "@nodedos/protocol";
import { Namespace } from "@nodedos/core";
import { MountManager } from "@nodedos/client";
import type { MountEvent } from "@nodedos/client";
import { handleMessage } from "./handler";
import { secretsMatch } from "./auth";

export type { MountEvent };

export interface ServerOptions {
  /** Require clients to authenticate with this shared secret before any other request. */
  secret?: string;
}

export interface RequestLogEvent {
  type: string;
  tag: number;
  /** Path-ish target of the request: path, "from -> to", or mount prefix. */
  path?: string;
  ms: number;
  ok: boolean;
  error?: string;
}

function pathOf(msg: NodeMessage): string | undefined {
  if ("path" in msg) return msg.path;
  if ("from" in msg) return `${msg.from} -> ${msg.to}`;
  if ("prefix" in msg) return msg.prefix;
  return undefined;
}

/**
 * Emits: "request" (RequestLogEvent) after each handled message, and
 * "mount" (MountEvent) as remote mount connections change state.
 */
export class NodeDOSServer extends EventEmitter {
  private server: net.Server;
  private sockets = new Set<net.Socket>();
  private secret?: string;
  readonly namespace: Namespace;
  readonly mounts: MountManager;

  constructor(options: ServerOptions = {}) {
    super();
    const secret = options.secret;
    this.secret = secret;
    this.namespace = new Namespace();
    this.mounts = new MountManager(this.namespace);
    this.mounts.on("mount", (e: MountEvent) => this.emit("mount", e));
    this.server = net.createServer((socket) => {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      const transport = new Transport(socket);
      let authenticated = false;
      transport.on("message", (msg) => {
        const start = performance.now();
        const finish = (ok: boolean, error?: string) => {
          const event: RequestLogEvent = {
            type: msg.type,
            tag: msg.tag,
            path: pathOf(msg),
            ms: performance.now() - start,
            ok,
          };
          if (error !== undefined) event.error = error;
          this.emit("request", event);
        };
        if (msg.type === "tauth") {
          if (secret === undefined || secretsMatch(String(msg.secret), secret)) {
            authenticated = true;
            transport.send({ type: "rauth", tag: msg.tag });
            finish(true);
          } else {
            transport.send({ type: "rerror", tag: msg.tag, ename: "Authentication failed" });
            finish(false, "Authentication failed");
          }
          return;
        }
        if (secret !== undefined && !authenticated) {
          transport.send({ type: "rerror", tag: msg.tag, ename: "Authentication required" });
          finish(false, "Authentication required");
          return;
        }
        if (msg.type === "tmount") {
          void this.handleMount(transport, msg).then((r) => finish(r.ok, r.error));
          return;
        }
        if (msg.type === "tunmount") {
          const r = this.handleUnmount(transport, msg);
          finish(r.ok, r.error);
          return;
        }
        void handleMessage(this.namespace, transport, msg).then((r) => finish(r.ok, r.error));
      });
      transport.on("error", (err: Error) => {
        process.stderr.write(`[nodedos] transport error: ${err.message}\n`);
        transport.destroy();
      });
    });
  }

  private async handleMount(transport: Transport, msg: TMountMsg): Promise<{ ok: boolean; error?: string }> {
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
      return { ok: true };
    } catch (err) {
      const ename = err instanceof Error ? err.message : String(err);
      transport.send({ type: "rerror", tag: msg.tag, ename });
      return { ok: false, error: ename };
    }
  }

  private handleUnmount(transport: Transport, msg: TUnmountMsg): { ok: boolean; error?: string } {
    try {
      this.mounts.unmountRemote(msg.prefix);
      transport.send({ type: "runmount", tag: msg.tag });
      return { ok: true };
    } catch (err) {
      const ename = err instanceof Error ? err.message : String(err);
      transport.send({ type: "rerror", tag: msg.tag, ename });
      return { ok: false, error: ename };
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
