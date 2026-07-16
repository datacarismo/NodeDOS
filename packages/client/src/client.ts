import * as net from "node:net";
import { Transport } from "@nodedos/protocol";
import type { NodeMessage, TMessage, RMessage } from "@nodedos/protocol";

interface Pending {
  resolve: (msg: RMessage) => void;
  reject: (err: Error) => void;
  timer?: NodeJS.Timeout;
}

export interface ClientOptions {
  /** Reject a request if no response arrives within this many ms. Default: no timeout. */
  requestTimeoutMs?: number;
  /** Automatically redial with exponential backoff when the connection drops. Default: false. */
  reconnect?: boolean;
  /** First reconnect delay in ms. Default: 500. */
  reconnectBaseMs?: number;
  /** Backoff ceiling in ms. Default: 30000. */
  reconnectMaxMs?: number;
  /** Shared secret sent in a tauth handshake before any other request (also after reconnects). */
  secret?: string;
}

// Distributive conditional — must be a generic type parameter in the check position
// so that the conditional distributes over each union member independently.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type TPayload = DistributiveOmit<TMessage, "tag">;

export class NodeDOSClient {
  private transport: Transport | null = null;
  private pending = new Map<number, Pending>();
  private tagCounter = 0;
  private host = "";
  private port = 0;
  private connected = false;
  private closed = false; // set by disconnect(); stops the reconnect loop
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs: number;

  constructor(private options: ClientOptions = {}) {
    this.backoffMs = options.reconnectBaseMs ?? 500;
  }

  connect(host: string, port: number): Promise<void> {
    this.host = host;
    this.port = port;
    this.closed = false;
    return this.dial();
  }

  isConnected(): boolean {
    return this.connected;
  }

  private dial(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      socket.once("connect", () => {
        this.backoffMs = this.options.reconnectBaseMs ?? 500;
        if (this.options.secret === undefined) {
          this.connected = true;
          resolve();
          return;
        }
        // Authenticate before marking the connection usable so no
        // filesystem request can race the handshake.
        this.authenticate(transport).then(
          () => {
            this.connected = true;
            resolve();
          },
          (err: Error) => {
            transport.destroy();
            reject(err);
          },
        );
      });
      socket.once("error", reject);
      const transport = new Transport(socket);
      this.transport = transport;
      transport.on("message", (msg: NodeMessage) => {
        const r = msg as RMessage;
        const p = this.pending.get(r.tag);
        if (p) {
          this.pending.delete(r.tag);
          if (p.timer) clearTimeout(p.timer);
          p.resolve(r);
        }
      });
      // Swallow transport-level errors; the socket's "close" always follows.
      transport.on("error", () => {});
      transport.on("close", () => {
        this.connected = false;
        for (const p of this.pending.values()) {
          if (p.timer) clearTimeout(p.timer);
          p.reject(new Error("Connection closed"));
        }
        this.pending.clear();
        this.scheduleReconnect();
      });
    });
  }

  private authenticate(transport: Transport): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tag = ++this.tagCounter;
      this.pending.set(tag, {
        resolve: (r: RMessage) => {
          if (r.type === "rauth") resolve();
          else if (r.type === "rerror") reject(new Error(r.ename));
          else reject(new Error(`Unexpected: ${r.type}`));
        },
        reject,
      });
      transport.send({ type: "tauth", tag, secret: this.options.secret! });
    });
  }

  private scheduleReconnect(): void {
    if (!this.options.reconnect || this.closed || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.options.reconnectMaxMs ?? 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closed) return;
      // A failed dial fires the transport's "close", which schedules the next attempt.
      this.dial().catch(() => {});
    }, delay);
    this.reconnectTimer.unref?.();
  }

  request(msg: TPayload): Promise<RMessage> {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.transport) {
        reject(new Error(`Not connected to ${this.host}:${this.port}`));
        return;
      }
      const tag = ++this.tagCounter;
      let timer: NodeJS.Timeout | undefined;
      const timeoutMs = this.options.requestTimeoutMs;
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.pending.delete(tag);
          reject(new Error(`Request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();
      }
      this.pending.set(tag, { resolve, reject, timer });
      this.transport.send({ ...msg, tag } as NodeMessage);
    });
  }

  disconnect(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connected = false;
    this.transport?.destroy();
  }
}
