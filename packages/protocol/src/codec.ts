import { Buffer } from "node:buffer";

export class FrameCodec {
  encode<T>(message: T): Buffer {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    const frame = Buffer.allocUnsafe(4 + payload.length);
    frame.writeUInt32BE(payload.length, 0);
    payload.copy(frame, 4);
    return frame;
  }

  decodeMany(buffer: Buffer): { messages: unknown[]; rest: Buffer } {
    const messages: unknown[] = [];
    let offset = 0;
    while (offset + 4 <= buffer.length) {
      const len = buffer.readUInt32BE(offset);
      if (offset + 4 + len > buffer.length) {
        break;
      }
      const payload = buffer.subarray(offset + 4, offset + 4 + len);
      messages.push(JSON.parse(payload.toString("utf8")));
      offset += 4 + len;
    }
    return { messages, rest: buffer.subarray(offset) };
  }
}
