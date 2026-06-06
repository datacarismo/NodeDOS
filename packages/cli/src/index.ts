#!/usr/bin/env node
import { Command } from "commander";
import { serverCommand } from "./commands/server";
import { lsCommand } from "./commands/ls";
import { catCommand } from "./commands/cat";
import { writeCommand } from "./commands/write";
import { mkdirCommand } from "./commands/mkdir";
import { startShell } from "@nodedos/shell";

const program = new Command();
program
  .name("nodedos")
  .description("Distributed filesystem operating system inspired by Plan 9")
  .version("0.1.0")
  .option("-s, --server <host:port>", "Server address for interactive shell", "localhost:9001")
  .action(async (opts: { server: string }) => {
    await startShell(opts.server);
  });

program.addCommand(serverCommand);
program.addCommand(lsCommand);
program.addCommand(catCommand);
program.addCommand(writeCommand);
program.addCommand(mkdirCommand);

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
