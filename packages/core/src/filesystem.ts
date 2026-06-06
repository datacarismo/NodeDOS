import type { Stat } from "@nodedos/protocol";

export type { Stat };

export interface Driver {
  stat(path: string): Promise<Stat>;
  read(path: string, offset: number, count: number): Promise<Buffer>;
  write(path: string, offset: number, data: Buffer): Promise<number>;
  readdir(path: string): Promise<Stat[]>;
  mkdir(path: string): Promise<void>;
}
