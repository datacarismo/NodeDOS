import { Command } from "commander";
import { Buffer } from "node:buffer";
import { NodeDOSClient } from "@nodedos/client";

const CHUNK = 65536;

export const catCommand = new Command("cat")
  .description("Print file contents from a NodeDOS server")
  .argument("<path>", "Remote path to read")
  .option("-s, --server <host:port>", "Server address", "localhost:9001")
  .action(async (remotePath: string, opts: { server: string }) => {
    const [host, portStr] = opts.server.split(":");
    const client = new NodeDOSClient();
    await client.connect(host, parseInt(portStr, 10));
    try {
      const statR = await client.request({ type: "tstat", path: remotePath });
      if (statR.type === "rerror") { console.error(statR.ename); process.exit(1); }
      if (statR.type !== "rstat") return;
      const { size } = statR.stat;
      let offset = 0;
      while (offset < size) {
        const count = Math.min(CHUNK, size - offset);
        const r = await client.request({ type: "tread", path: remotePath, offset, count });
        if (r.type === "rerror") { console.error(r.ename); process.exit(1); }
        if (r.type !== "rread") break;
        process.stdout.write(Buffer.from(r.data, "base64"));
        offset += count;
      }
    } finally {
      client.disconnect();
    }
  });
