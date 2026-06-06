import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import { Buffer } from "node:buffer";
import { FrameCodec } from "./codec";
import type { NodeMessage } from "./types";

export class Transport extends EventEmitter {
  private codec = new FrameCodec();
  // Typed as ArrayBufferLike to accommodate Buffer.concat's return type.
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  constructor(private socket: Socket) {
    super();
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const { messages, rest } = this.codec.decodeMany(this.buffer);
      this.buffer = rest;
      for (const msg of messages) {
        this.emit("message", msg as NodeMessage);
      }
    });
    socket.on("close", () => this.emit("close"));
    socket.on("error", (err: Error) => this.emit("error", err));
  }

  send(msg: NodeMessage): void {
    this.socket.write(this.codec.encode(msg));
  }

  destroy(): void {
    this.socket.destroy();
  }
}
