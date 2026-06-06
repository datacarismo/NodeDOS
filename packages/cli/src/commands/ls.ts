import { Command } from "commander";
import { NodeDOSClient } from "@nodedos/client";

export const lsCommand = new Command("ls")
  .description("List directory contents on a NodeDOS server")
  .argument("<path>", "Remote path to list")
  .option("-s, --server <host:port>", "Server address", "localhost:9001")
  .action(async (remotePath: string, opts: { server: string }) => {
    const [host, portStr] = opts.server.split(":");
    const client = new NodeDOSClient();
    await client.connect(host, parseInt(portStr, 10));
    try {
      const r = await client.request({ type: "treaddir", path: remotePath });
      if (r.type === "rerror") { console.error(r.ename); process.exit(1); }
      if (r.type !== "rreaddir") return;
      for (const e of r.entries) {
        const kind = e.isDir ? "d" : "-";
        const size = e.isDir ? "-" : String(e.size).padStart(8);
        console.log(`${kind}  ${size}  ${e.name}`);
      }
    } finally {
      client.disconnect();
    }
  });
