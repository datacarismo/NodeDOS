import type { Stat } from "@nodedos/protocol";

export type { Stat };

export interface Driver {
  stat(path: string): Promise<Stat>;
  read(path: string, offset: number, count: number): Promise<Buffer>;
  write(path: string, offset: number, data: Buffer): Promise<number>;
  readdir(path: string): Promise<Stat[]>;
  mkdir(path: string): Promise<void>;
  /** Remove a file or empty directory. */
  remove(path: string): Promise<void>;
  /** Rename/move within the same driver. */
  rename(from: string, to: string): Promise<void>;
  /** Set a file's size, extending with zero bytes if needed. */
  truncate(path: string, size: number): Promise<void>;
}
