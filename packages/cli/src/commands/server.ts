import { Command } from "commander";
import { NodeDOSServer } from "@nodedos/server";
import type { RequestLogEvent, MountEvent } from "@nodedos/server";
import { PosixDriver } from "@nodedos/fs-drivers";

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
  .option(
    "-k, --secret <secret>",
    "Require clients to authenticate with this shared secret; also used when connecting to mounts (default: NODEDOS_SECRET env)",
    process.env.NODEDOS_SECRET,
  )
  .option("-v, --verbose", "Log every request and mount state change to stderr")
  .action(async (opts: { port: number; root: string; mount: string[]; secret?: string; verbose?: boolean }) => {
    const server = new NodeDOSServer({ secret: opts.secret });
    server.namespace.mount("/", new PosixDriver(opts.root));

    if (opts.verbose) {
      server.on("request", (e: RequestLogEvent) => {
        const target = e.path ? ` ${e.path}` : "";
        const status = e.ok ? "ok" : `ERR ${e.error}`;
        process.stderr.write(`[req] ${e.type}${target} ${e.ms.toFixed(1)}ms ${status}\n`);
      });
      server.on("mount", (e: MountEvent) => {
        process.stderr.write(`[mount ${e.prefix}] ${e.state}\n`);
      });
    }

    for (const spec of opts.mount) {
      const match = spec.match(/^([^=]+)=([^:]+):(\d+)$/);
      if (!match) {
        console.error(`Invalid --mount spec "${spec}". Expected /prefix=host:port`);
        process.exit(1);
      }
      const [, prefix, host, portStr] = match;
      const remotePort = parseInt(portStr, 10);
      await server.mounts.mountRemote(prefix, host, remotePort, {
        reconnect: true,
        requestTimeoutMs: 10_000,
        secret: opts.secret,
      });
      console.log(`Mounted ${host}:${remotePort} at ${prefix}`);
    }

    await server.listen(opts.port);
    console.log(`NodeDOS server listening on port ${opts.port}, serving ${opts.root}`);
  });
