import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PassThrough } from "node:stream";
import { NodeDOSServer } from "@nodedos/server";
import { NodeDOSClient } from "@nodedos/client";
import { MemoryDriver } from "@nodedos/fs-drivers";
import { startShell } from "@nodedos/shell";

const PORT = 19601;

let server: NodeDOSServer;
let client: NodeDOSClient;

beforeAll(async () => {
  server = new NodeDOSServer();
  server.namespace.mount("/", new MemoryDriver());
  await server.listen(PORT, "127.0.0.1");
  client = new NodeDOSClient();
  await client.connect("127.0.0.1", PORT);
});

afterAll(async () => {
  client.disconnect();
  await server.close();
});

describe("shell with piped (non-TTY) input", () => {
  it("runs every piped command even when input ends early", async () => {
    // All input (including EOF) arrives while the first command is still
    // awaiting the network; the shell must still run the rest of the script.
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume(); // discard

    const done = startShell(`localhost:${PORT}`, { input, output });
    input.end("write /first.txt one\nwrite /second.txt two\nmkdir /third\n");

    await expect(done).resolves.toBeUndefined();

    const first = await client.request({ type: "tstat", path: "/first.txt" });
    expect(first.type).toBe("rstat");
    const second = await client.request({ type: "tstat", path: "/second.txt" });
    expect(second.type).toBe("rstat");
    const third = await client.request({ type: "tstat", path: "/third" });
    expect(third.type).toBe("rstat");
  });

  it("exits cleanly on the exit command with input still open", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();

    const done = startShell(`localhost:${PORT}`, { input, output });
    input.write("mkdir /fromexit\nexit\n");

    await expect(done).resolves.toBeUndefined();
    const r = await client.request({ type: "tstat", path: "/fromexit" });
    expect(r.type).toBe("rstat");
    input.end();
  });
});
