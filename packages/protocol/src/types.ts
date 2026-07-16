export interface Stat {
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
  mode: number;
}

// T-messages: client → server requests
export interface TAuthMsg    { type: "tauth";     tag: number; secret: string }
export interface TStatMsg    { type: "tstat";     tag: number; path: string }
export interface TReadMsg    { type: "tread";     tag: number; path: string; offset: number; count: number }
export interface TWriteMsg   { type: "twrite";    tag: number; path: string; offset: number; data: string }
export interface TReaddirMsg { type: "treaddir";  tag: number; path: string }
export interface TMkdirMsg   { type: "tmkdir";    tag: number; path: string }
export interface TRemoveMsg  { type: "tremove";   tag: number; path: string }
export interface TRenameMsg  { type: "trename";   tag: number; from: string; to: string }
export interface TTruncateMsg{ type: "ttruncate"; tag: number; path: string; size: number }
export interface TMountMsg   { type: "tmount";    tag: number; prefix: string; host: string; port: number; secret?: string }
export interface TUnmountMsg { type: "tunmount";  tag: number; prefix: string }

// R-messages: server → client responses
export interface RAuthMsg    { type: "rauth";     tag: number }
export interface RStatMsg    { type: "rstat";     tag: number; stat: Stat }
export interface RReadMsg    { type: "rread";     tag: number; data: string }
export interface RWriteMsg   { type: "rwrite";    tag: number; count: number }
export interface RReaddirMsg { type: "rreaddir";  tag: number; entries: Stat[] }
export interface RMkdirMsg   { type: "rmkdir";    tag: number }
export interface RRemoveMsg  { type: "rremove";   tag: number }
export interface RRenameMsg  { type: "rrename";   tag: number }
export interface RTruncateMsg{ type: "rtruncate"; tag: number }
export interface RMountMsg   { type: "rmount";    tag: number }
export interface RUnmountMsg { type: "runmount";  tag: number }
export interface RErrorMsg   { type: "rerror";    tag: number; ename: string }

export type TMessage =
  | TAuthMsg
  | TStatMsg | TReadMsg | TWriteMsg | TReaddirMsg | TMkdirMsg
  | TRemoveMsg | TRenameMsg | TTruncateMsg
  | TMountMsg | TUnmountMsg;
export type RMessage =
  | RAuthMsg
  | RStatMsg | RReadMsg | RWriteMsg | RReaddirMsg | RMkdirMsg
  | RRemoveMsg | RRenameMsg | RTruncateMsg
  | RMountMsg | RUnmountMsg | RErrorMsg;
export type NodeMessage = TMessage | RMessage;
