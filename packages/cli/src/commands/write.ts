import { Command } from "commander";
import { Buffer } from "node:buffer";
import { NodeDOSClient } from "@nodedos/client";

export const writeCommand = new Command("write")
  .description("Write content to a file on a NodeDOS server")
  .argument("<path>", "Remote path to write")
  .argument("<content>", "Content to write (UTF-8)")
  .option("-s, --server <host:port>", "Server address", "localhost:9001")
  .action(async (remotePath: string, content: string, opts: { server: string }) => {
    const [host, portStr] = opts.server.split(":");
    const client = new NodeDOSClient();
    await client.connect(host, parseInt(portStr, 10));
    try {
      const data = Buffer.from(content, "utf8");
      const r = await client.request({
        type: "twrite",
        path: remotePath,
        offset: 0,
        data: data.toString("base64"),
      });
      if (r.type === "rerror") { console.error(r.ename); process.exit(1); }
      if (r.type === "rwrite") console.log(`Written ${r.count} bytes`);
    } finally {
      client.disconnect();
    }
  });
