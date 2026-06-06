export interface Stat {
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
  mode: number;
}

// T-messages: client → server requests
export interface TStatMsg   { type: "tstat";    tag: number; path: string }
export interface TReadMsg   { type: "tread";    tag: number; path: string; offset: number; count: number }
export interface TWriteMsg  { type: "twrite";   tag: number; path: string; offset: number; data: string }
export interface TReaddirMsg{ type: "treaddir"; tag: number; path: string }
export interface TMkdirMsg  { type: "tmkdir";   tag: number; path: string }

// R-messages: server → client responses
export interface RStatMsg   { type: "rstat";    tag: number; stat: Stat }
export interface RReadMsg   { type: "rread";    tag: number; data: string }
export interface RWriteMsg  { type: "rwrite";   tag: number; count: number }
export interface RReaddirMsg{ type: "rreaddir"; tag: number; entries: Stat[] }
export interface RMkdirMsg  { type: "rmkdir";   tag: number }
export interface RErrorMsg  { type: "rerror";   tag: number; ename: string }

export type TMessage = TStatMsg | TReadMsg | TWriteMsg | TReaddirMsg | TMkdirMsg;
export type RMessage = RStatMsg | RReadMsg | RWriteMsg | RReaddirMsg | RMkdirMsg | RErrorMsg;
export type NodeMessage = TMessage | RMessage;
