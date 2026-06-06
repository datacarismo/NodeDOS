import * as readline from "node:readline";
import { Buffer } from "node:buffer";
import { NodeDOSClient } from "@nodedos/client";

const CHUNK = 65536;

function normalizePath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== ".") resolved.push(part);
  }
  return "/" + resolved.join("/");
}

function resolvePath(cwd: string, input: string): string {
  if (input.startsWith("/")) return normalizePath(input);
  return normalizePath(cwd + "/" + input);
}

async function withClient<T>(
  server: string,
  fn: (client: NodeDOSClient) => Promise<T>
): Promise<T> {
  const [host, portStr] = server.split(":");
  const client = new NodeDOSClient();
  await client.connect(host, parseInt(portStr, 10));
  try {
    return await fn(client);
  } finally {
    client.disconnect();
  }
}

async function cmdLs(path: string, server: string): Promise<void> {
  await withClient(server, async (client) => {
    const r = await client.request({ type: "treaddir", path });
    if (r.type === "rerror") { console.error(r.ename); return; }
    if (r.type !== "rreaddir") return;
    if (r.entries.length === 0) return;
    for (const e of r.entries) {
      const kind = e.isDir ? "d" : "-";
      const size = e.isDir ? "        -" : String(e.size).padStart(9);
      console.log(`${kind}  ${size}  ${e.name}`);
    }
  });
}

async function cmdCat(path: string, server: string): Promise<void> {
  await withClient(server, async (client) => {
    const statR = await client.request({ type: "tstat", path });
    if (statR.type === "rerror") { console.error(statR.ename); return; }
    if (statR.type !== "rstat") return;
    const { size } = statR.stat;
    let offset = 0;
    while (offset < size) {
      const count = Math.min(CHUNK, size - offset);
      const r = await client.request({ type: "tread", path, offset, count });
      if (r.type === "rerror") { console.error(r.ename); return; }
      if (r.type !== "rread") break;
      process.stdout.write(Buffer.from(r.data, "base64"));
      offset += count;
    }
    if (size > 0) process.stdout.write("\n");
  });
}

async function cmdWrite(path: string, content: string, server: string): Promise<void> {
  await withClient(server, async (client) => {
    const data = Buffer.from(content, "utf8");
    const r = await client.request({
      type: "twrite",
      path,
      offset: 0,
      data: data.toString("base64"),
    });
    if (r.type === "rerror") { console.error(r.ename); return; }
    if (r.type === "rwrite") console.log(`Written ${r.count} bytes`);
  });
}

async function cmdMkdir(path: string, server: string): Promise<void> {
  await withClient(server, async (client) => {
    const r = await client.request({ type: "tmkdir", path });
    if (r.type === "rerror") { console.error(r.ename); return; }
    console.log(`Created ${path}`);
  });
}

async function cmdCd(
  path: string,
  server: string,
  state: { cwd: string }
): Promise<void> {
  await withClient(server, async (client) => {
    const r = await client.request({ type: "tstat", path });
    if (r.type === "rerror") { console.error(r.ename); return; }
    if (r.type !== "rstat") return;
    if (!r.stat.isDir) { console.error(`Not a directory: ${path}`); return; }
    state.cwd = path;
  });
}

function printHelp(): void {
  console.log(`
  ls [path]               List directory (default: current directory)
  cat <path>              Print file contents
  write <path> <content>  Write content to file
  mkdir <path>            Create directory
  cd <path>               Change directory
  pwd                     Print current directory
  server <host:port>      Change connected server
  help                    Show this help
  exit                    Exit NodeDOS shell
`);
}

export async function startShell(initialServer = "localhost:9001"): Promise<void> {
  const state = { cwd: "/", server: initialServer };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  });

  const getPrompt = () => `nodedos:${state.cwd || "/"}> `;

  console.log(`NodeDOS Shell  [server: ${state.server}]`);
  console.log(`Type "help" for available commands.\n`);

  rl.setPrompt(getPrompt());
  rl.prompt();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.setPrompt(getPrompt());
      rl.prompt();
      continue;
    }

    // simple tokenizer — handles "quoted strings"
    const tokens = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
    const unquote = (s: string) => s.replace(/^(["'])(.*)\1$/, "$2");
    const [cmd, ...rawArgs] = tokens;
    const args = rawArgs.map(unquote);

    try {
      switch (cmd) {
        case "help":
          printHelp();
          break;

        case "pwd":
          console.log(state.cwd || "/");
          break;

        case "exit":
        case "quit":
          rl.close();
          process.emit("SIGTERM");
          return;

        case "server":
          if (!args[0]) { console.error("Usage: server <host:port>"); break; }
          state.server = args[0];
          console.log(`Server set to ${state.server}`);
          break;

        case "cd": {
          const target = args[0] ? resolvePath(state.cwd, args[0]) : "/";
          await cmdCd(target, state.server, state);
          break;
        }

        case "ls": {
          const target = args[0] ? resolvePath(state.cwd, args[0]) : state.cwd;
          await cmdLs(target, state.server);
          break;
        }

        case "cat": {
          if (!args[0]) { console.error("Usage: cat <path>"); break; }
          await cmdCat(resolvePath(state.cwd, args[0]), state.server);
          break;
        }

        case "write": {
          if (!args[0] || args[1] === undefined) {
            console.error("Usage: write <path> <content>");
            break;
          }
          await cmdWrite(
            resolvePath(state.cwd, args[0]),
            args.slice(1).join(" "),
            state.server
          );
          break;
        }

        case "mkdir": {
          if (!args[0]) { console.error("Usage: mkdir <path>"); break; }
          await cmdMkdir(resolvePath(state.cwd, args[0]), state.server);
          break;
        }

        default:
          console.error(`Unknown command: "${cmd}". Type "help" for available commands.`);
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    rl.setPrompt(getPrompt());
    rl.prompt();
  }
}
