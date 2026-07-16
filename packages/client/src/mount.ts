import { Namespace } from "@nodedos/core";
import { NodeDOSClient, type ClientOptions } from "./client";
import { RemoteDriver } from "./remote-driver";

export class MountManager {
  readonly namespace: Namespace;
  private clients = new Map<string, NodeDOSClient>();

  constructor(ns?: Namespace) {
    this.namespace = ns ?? new Namespace();
  }

  async mountRemote(
    prefix: string,
    host: string,
    port: number,
    options: ClientOptions = { reconnect: true },
  ): Promise<void> {
    const client = new NodeDOSClient(options);
    await client.connect(host, port);
    // Replace, don't leak: disconnect any client already mounted here.
    this.clients.get(prefix)?.disconnect();
    this.clients.set(prefix, client);
    this.namespace.mount(prefix, new RemoteDriver(client));
  }

  unmountRemote(prefix: string): void {
    const client = this.clients.get(prefix);
    if (!client) throw new Error(`No such mount: ${prefix}`);
    client.disconnect();
    this.clients.delete(prefix);
    this.namespace.unmount(prefix);
  }

  hasMount(prefix: string): boolean {
    return this.clients.has(prefix);
  }
}
