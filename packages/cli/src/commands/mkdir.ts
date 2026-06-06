import { Command } from "commander";
import { NodeDOSClient } from "@nodedos/client";

export const mkdirCommand = new Command("mkdir")
  .description("Create a directory on a NodeDOS server")
  .argument("<path>", "Remote path to create")
  .option("-s, --server <host:port>", "Server address", "localhost:9001")
  .action(async (remotePath: string, opts: { server: string }) => {
    const [host, portStr] = opts.server.split(":");
    const client = new NodeDOSClient();
    await client.connect(host, parseInt(portStr, 10));
    try {
      const r = await client.request({ type: "tmkdir", path: remotePath });
      if (r.type === "rerror") { console.error(r.ename); process.exit(1); }
      console.log(`Created ${remotePath}`);
    } finally {
      client.disconnect();
    }
  });
