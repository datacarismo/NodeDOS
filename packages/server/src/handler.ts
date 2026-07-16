import { Buffer } from "node:buffer";
import type { Transport, NodeMessage, TMessage } from "@nodedos/protocol";
import type { Namespace } from "@nodedos/core";

const T_TYPES = new Set<string>([
  "tstat", "tread", "twrite", "treaddir", "tmkdir",
  "tremove", "trename", "ttruncate",
]);

function isTMessage(msg: NodeMessage): msg is TMessage {
  return T_TYPES.has(msg.type);
}

export async function handleMessage(
  ns: Namespace,
  transport: Transport,
  msg: NodeMessage,
): Promise<void> {
  if (!isTMessage(msg)) return;
  const { tag } = msg;
  try {
    switch (msg.type) {
      case "tstat": {
        const { driver, relativePath } = ns.resolve(msg.path);
        const stat = await driver.stat(relativePath);
        transport.send({ type: "rstat", tag, stat });
        break;
      }
      case "tread": {
        const { driver, relativePath } = ns.resolve(msg.path);
        const data = await driver.read(relativePath, msg.offset, msg.count);
        transport.send({ type: "rread", tag, data: data.toString("base64") });
        break;
      }
      case "twrite": {
        const { driver, relativePath } = ns.resolve(msg.path);
        const data = Buffer.from(msg.data, "base64");
        const count = await driver.write(relativePath, msg.offset, data);
        transport.send({ type: "rwrite", tag, count });
        break;
      }
      case "treaddir": {
        const { driver, relativePath } = ns.resolve(msg.path);
        const entries = await driver.readdir(relativePath);
        transport.send({ type: "rreaddir", tag, entries });
        break;
      }
      case "tmkdir": {
        const { driver, relativePath } = ns.resolve(msg.path);
        await driver.mkdir(relativePath);
        transport.send({ type: "rmkdir", tag });
        break;
      }
      case "tremove": {
        const { driver, relativePath } = ns.resolve(msg.path);
        await driver.remove(relativePath);
        transport.send({ type: "rremove", tag });
        break;
      }
      case "trename": {
        const from = ns.resolve(msg.from);
        const to = ns.resolve(msg.to);
        if (from.driver !== to.driver) {
          throw new Error("Cannot rename across mounts");
        }
        await from.driver.rename(from.relativePath, to.relativePath);
        transport.send({ type: "rrename", tag });
        break;
      }
      case "ttruncate": {
        const { driver, relativePath } = ns.resolve(msg.path);
        await driver.truncate(relativePath, msg.size);
        transport.send({ type: "rtruncate", tag });
        break;
      }
      default: {
        const unknownType = (msg as { type: string }).type;
        transport.send({ type: "rerror", tag, ename: `Unknown message type: ${unknownType}` });
        break;
      }
    }
  } catch (err) {
    const ename = err instanceof Error ? err.message : String(err);
    transport.send({ type: "rerror", tag, ename });
  }
}
