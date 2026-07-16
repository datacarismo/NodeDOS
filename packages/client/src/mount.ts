import { EventEmitter } from "node:events";
import { Namespace } from "@nodedos/core";
import { NodeDOSClient, type ClientOptions } from "./client";
import { RemoteDriver } from "./remote-driver";

export interface MountEvent {
  prefix: string;
  state: "connected" | "disconnected" | "reconnecting";
}

/** Emits: "mount" (MountEvent) as each remote's connection state changes. */
export class MountManager extends EventEmitter {
  readonly namespace: Namespace;
  private clients = new Map<string, NodeDOSClient>();

  constructor(ns?: Namespace) {
    super();
    this.namespace = ns ?? new Namespace();
  }

  async mountRemote(
    prefix: string,
    host: string,
    port: number,
    options: ClientOptions = { reconnect: true },
  ): Promise<void> {
    const client = new NodeDOSClient(options);
    const forward = (state: MountEvent["state"]) => this.emit("mount", { prefix, state });
    client.on("connected", () => forward("connected"));
    client.on("disconnected", () => forward("disconnected"));
    client.on("reconnecting", () => forward("reconnecting"));
    await client.connect(host, port);
    // Replace, don't leak: silence and disconnect any client already mounted here.
    const old = this.clients.get(prefix);
    if (old) {
      old.removeAllListeners();
      old.disconnect();
    }
    this.clients.set(prefix, client);
    this.namespace.mount(prefix, new RemoteDriver(client));
  }

  unmountRemote(prefix: string): void {
    const client = this.clients.get(prefix);
    if (!client) throw new Error(`No such mount: ${prefix}`);
    client.removeAllListeners(); // deliberate detach — not a health event
    client.disconnect();
    this.clients.delete(prefix);
    this.namespace.unmount(prefix);
  }

  hasMount(prefix: string): boolean {
    return this.clients.has(prefix);
  }
}
