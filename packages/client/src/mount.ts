import { Namespace } from "@nodedos/core";
import { NodeDOSClient } from "./client";
import { RemoteDriver } from "./remote-driver";

export class MountManager {
  readonly namespace: Namespace;
  private clients = new Map<string, NodeDOSClient>();

  constructor(ns?: Namespace) {
    this.namespace = ns ?? new Namespace();
  }

  async mountRemote(prefix: string, host: string, port: number): Promise<void> {
    const client = new NodeDOSClient();
    await client.connect(host, port);
    this.clients.set(prefix, client);
    this.namespace.mount(prefix, new RemoteDriver(client));
  }

  unmountRemote(prefix: string): void {
    const client = this.clients.get(prefix);
    if (client) {
      client.disconnect();
      this.clients.delete(prefix);
    }
    this.namespace.unmount(prefix);
  }
}
