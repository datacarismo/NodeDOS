import { Command } from "commander";
import { NodeDOSServer } from "@nodedos/server";
import { PosixDriver } from "@nodedos/fs-drivers";
import { NodeDOSClient } from "@nodedos/client";
import { RemoteDriver } from "@nodedos/client";

export const serverCommand = new Command("server")
  .description("Start a NodeDOS server")
  .requiredOption("-p, --port <number>", "Port to listen on", parseInt)
  .requiredOption("-r, --root <path>", "Local directory to expose as /")
  .option(
    "-m, --mount <spec>",
    "Mount a remote node: /prefix=host:port (repeatable)",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .action(async (opts: { port: number; root: string; mount: string[] }) => {
    const server = new NodeDOSServer();
    server.namespace.mount("/", new PosixDriver(opts.root));

    for (const spec of opts.mount) {
      const match = spec.match(/^([^=]+)=([^:]+):(\d+)$/);
      if (!match) {
        console.error(`Invalid --mount spec "${spec}". Expected /prefix=host:port`);
        process.exit(1);
      }
      const [, prefix, host, portStr] = match;
      const remotePort = parseInt(portStr, 10);
      const client = new NodeDOSClient();
      await client.connect(host, remotePort);
      server.namespace.mount(prefix, new RemoteDriver(client));
      console.log(`Mounted ${host}:${remotePort} at ${prefix}`);
    }

    await server.listen(opts.port);
    console.log(`NodeDOS server listening on port ${opts.port}, serving ${opts.root}`);
  });
