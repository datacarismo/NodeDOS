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

interface Conn {
  server: string;
  secret?: string;
}

async function withClient<T>(
  conn: Conn,
  fn: (client: NodeDOSClient) => Promise<T>
): Promise<T> {
  const [host, portStr] = conn.server.split(":");
  const client = new NodeDOSClient({ secret: conn.secret });
  await client.connect(host, parseInt(portStr, 10));
  try {
    return await fn(client);
  } finally {
    client.disconnect();
  }
}

async function cmdLs(path: string, conn: Conn): Promise<void> {
  await withClient(conn, async (client) => {
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

async function cmdCat(path: string, conn: Conn): Promise<void> {
  await withClient(conn, async (client) => {
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

async function cmdWrite(path: string, content: string, conn: Conn): Promise<void> {
  await withClient(conn, async (client) => {
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

async function cmdMkdir(path: string, conn: Conn): Promise<void> {
  await withClient(conn, async (client) => {
    const r = await client.request({ type: "tmkdir", path });
    if (r.type === "rerror") { console.error(r.ename); return; }
    console.log(`Created ${path}`);
  });
}

async function cmdRm(path: string, conn: Conn): Promise<void> {
  await withClient(conn, async (client) => {
    const r = await client.request({ type: "tremove", path });
    if (r.type === "rerror") { console.error(r.ename); return; }
    console.log(`Removed ${path}`);
  });
}

async function cmdMv(from: string, to: string, conn: Conn): Promise<void> {
  await withClient(conn, async (client) => {
    const r = await client.request({ type: "trename", from, to });
    if (r.type === "rerror") { console.error(r.ename); return; }
    console.log(`Renamed ${from} → ${to}`);
  });
}

async function cmdTruncate(path: string, size: number, conn: Conn): Promise<void> {
  await withClient(conn, async (client) => {
    const r = await client.request({ type: "ttruncate", path, size });
    if (r.type === "rerror") { console.error(r.ename); return; }
    console.log(`Truncated ${path} to ${size} bytes`);
  });
}

async function cmdMount(prefix: string, target: string, conn: Conn): Promise<void> {
  const [host, portStr] = target.split(":");
  const port = parseInt(portStr, 10);
  if (!host || Number.isNaN(port)) {
    console.error("Usage: mount /prefix host:port");
    return;
  }
  await withClient(conn, async (client) => {
    const r = await client.request({ type: "tmount", prefix, host, port });
    if (r.type === "rerror") { console.error(r.ename); return; }
    console.log(`Mounted ${host}:${port} at ${prefix}`);
  });
}

async function cmdUnmount(prefix: string, conn: Conn): Promise<void> {
  await withClient(conn, async (client) => {
    const r = await client.request({ type: "tunmount", prefix });
    if (r.type === "rerror") { console.error(r.ename); return; }
    console.log(`Unmounted ${prefix}`);
  });
}

async function cmdCd(
  path: string,
  conn: Conn,
  state: { cwd: string }
): Promise<void> {
  await withClient(conn, async (client) => {
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
  rm <path>               Remove file or empty directory
  mv <from> <to>          Rename/move within one node
  truncate <path> <size>  Set file size (extends with zeros)
  mount /prefix host:port Attach a remote node at /prefix
  unmount /prefix         Detach a remote mount
  cd <path>               Change directory
  pwd                     Print current directory
  server <host:port>      Change connected server
  help                    Show this help
  exit                    Exit NodeDOS shell
`);
}

export interface ShellIO {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Shared secret used to authenticate to servers. */
  secret?: string;
}

export async function startShell(initialServer = "localhost:9001", io: ShellIO = {}): Promise<void> {
  const state = { cwd: "/", server: initialServer, secret: io.secret };
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;

  const rl = readline.createInterface({
    input,
    output,
    terminal: "isTTY" in input ? Boolean((input as NodeJS.ReadStream).isTTY) : false,
  });

  // With piped input, EOF can close the interface while a command is still
  // running; prompting a closed readline throws ERR_USE_AFTER_CLOSE.
  let closed = false;
  rl.on("close", () => { closed = true; });
  const promptAgain = () => {
    if (closed) return;
    rl.setPrompt(getPrompt());
    rl.prompt();
  };

  const getPrompt = () => `nodedos:${state.cwd || "/"}> `;

  console.log(`NodeDOS Shell  [server: ${state.server}]`);
  console.log(`Type "help" for available commands.\n`);

  promptAgain();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      promptAgain();
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
          return;

        case "server":
          if (!args[0]) { console.error("Usage: server <host:port>"); break; }
          state.server = args[0];
          console.log(`Server set to ${state.server}`);
          break;

        case "cd": {
          const target = args[0] ? resolvePath(state.cwd, args[0]) : "/";
          await cmdCd(target, state, state);
          break;
        }

        case "ls": {
          const target = args[0] ? resolvePath(state.cwd, args[0]) : state.cwd;
          await cmdLs(target, state);
          break;
        }

        case "cat": {
          if (!args[0]) { console.error("Usage: cat <path>"); break; }
          await cmdCat(resolvePath(state.cwd, args[0]), state);
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
            state
          );
          break;
        }

        case "mkdir": {
          if (!args[0]) { console.error("Usage: mkdir <path>"); break; }
          await cmdMkdir(resolvePath(state.cwd, args[0]), state);
          break;
        }

        case "rm": {
          if (!args[0]) { console.error("Usage: rm <path>"); break; }
          await cmdRm(resolvePath(state.cwd, args[0]), state);
          break;
        }

        case "mv": {
          if (!args[0] || !args[1]) { console.error("Usage: mv <from> <to>"); break; }
          await cmdMv(
            resolvePath(state.cwd, args[0]),
            resolvePath(state.cwd, args[1]),
            state
          );
          break;
        }

        case "mount": {
          if (!args[0] || !args[1]) { console.error("Usage: mount /prefix host:port"); break; }
          await cmdMount(resolvePath(state.cwd, args[0]), args[1], state);
          break;
        }

        case "unmount": {
          if (!args[0]) { console.error("Usage: unmount /prefix"); break; }
          await cmdUnmount(resolvePath(state.cwd, args[0]), state);
          break;
        }

        case "truncate": {
          const size = parseInt(args[1], 10);
          if (!args[0] || Number.isNaN(size) || size < 0) {
            console.error("Usage: truncate <path> <size>");
            break;
          }
          await cmdTruncate(resolvePath(state.cwd, args[0]), size, state);
          break;
        }

        default:
          console.error(`Unknown command: "${cmd}". Type "help" for available commands.`);
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    promptAgain();
  }
}
