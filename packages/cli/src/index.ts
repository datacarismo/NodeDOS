#!/usr/bin/env node
import { Command } from "commander";
import { serverCommand } from "./commands/server";
import { lsCommand } from "./commands/ls";
import { catCommand } from "./commands/cat";
import { writeCommand } from "./commands/write";
import { mkdirCommand } from "./commands/mkdir";
import { rmCommand } from "./commands/rm";
import { mvCommand } from "./commands/mv";
import { startShell } from "@nodedos/shell";

const program = new Command();
program
  // Without this, the root -s/--server option captures the flag even when
  // it appears after a subcommand, and the subcommand only sees its default.
  .enablePositionalOptions()
  .name("nodedos")
  .description("Distributed filesystem operating system inspired by Plan 9")
  .version("0.2.0")
  .option("-s, --server <host:port>", "Server address for interactive shell", "localhost:9001")
  .option("-k, --secret <secret>", "Shared secret (default: NODEDOS_SECRET env)", process.env.NODEDOS_SECRET)
  .action(async (opts: { server: string; secret?: string }) => {
    await startShell(opts.server, { secret: opts.secret });
  });

program.addCommand(serverCommand);
program.addCommand(lsCommand);
program.addCommand(catCommand);
program.addCommand(writeCommand);
program.addCommand(mkdirCommand);
program.addCommand(rmCommand);
program.addCommand(mvCommand);

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
