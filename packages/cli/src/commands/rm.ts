import { Command } from "commander";
import { NodeDOSClient } from "@nodedos/client";

export const rmCommand = new Command("rm")
  .description("Remove a file or empty directory on a NodeDOS server")
  .argument("<path>", "Remote path to remove")
  .option("-s, --server <host:port>", "Server address", "localhost:9001")
  .action(async (remotePath: string, opts: { server: string }) => {
    const [host, portStr] = opts.server.split(":");
    const client = new NodeDOSClient();
    await client.connect(host, parseInt(portStr, 10));
    try {
      const r = await client.request({ type: "tremove", path: remotePath });
      if (r.type === "rerror") { console.error(r.ename); process.exit(1); }
      console.log(`Removed ${remotePath}`);
    } finally {
      client.disconnect();
    }
  });
