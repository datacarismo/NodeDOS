import { Command } from "commander";
import { NodeDOSClient } from "@nodedos/client";

export const mvCommand = new Command("mv")
  .description("Rename/move a file or directory on a NodeDOS server")
  .argument("<from>", "Source path")
  .argument("<to>", "Destination path")
  .option("-s, --server <host:port>", "Server address", "localhost:9001")
  .action(async (from: string, to: string, opts: { server: string }) => {
    const [host, portStr] = opts.server.split(":");
    const client = new NodeDOSClient();
    await client.connect(host, parseInt(portStr, 10));
    try {
      const r = await client.request({ type: "trename", from, to });
      if (r.type === "rerror") { console.error(r.ename); process.exit(1); }
      console.log(`Renamed ${from} → ${to}`);
    } finally {
      client.disconnect();
    }
  });
