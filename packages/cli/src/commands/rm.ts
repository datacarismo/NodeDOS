import { Command } from "commander";
import { NodeDOSClient } from "@nodedos/client";

export const rmCommand = new Command("rm")
  .description("Remove a file or empty directory on a NodeDOS server")
  .argument("<path>", "Remote path to remove")
  .option("-s, --server <host:port>", "Server address", "localhost:9001")
  .option("-k, --secret <secret>", "Shared secret (default: NODEDOS_SECRET env)", process.env.NODEDOS_SECRET)
  .action(async (remotePath: string, opts: { server: string; secret?: string }) => {
    const [host, portStr] = opts.server.split(":");
    const client = new NodeDOSClient({ secret: opts.secret });
    await client.connect(host, parseInt(portStr, 10));
    try {
      const r = await client.request({ type: "tremove", path: remotePath });
      if (r.type === "rerror") { console.error(r.ename); process.exit(1); }
      console.log(`Removed ${remotePath}`);
    } finally {
      client.disconnect();
    }
  });
