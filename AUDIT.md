# NodeDOS — Code Audit & Recommendations

**Date:** 2026-06-05  
**Project:** NodeDOS — Plan 9-inspired distributed filesystem  
**Runtime:** Node.js v18.19.1 / TypeScript 5.5+ / CommonJS  

---

## 1. Overall Verdict

**Well-structured, functional MVP.** The architecture is clean, separation of concerns is excellent, and TypeScript compiles cleanly (all 7 packages pass `tsc --build`). The project delivers the core promise: a CLI-driven server that can mount a local POSIX directory, expose a remote node via TCP, and compose both into a unified namespace through a `--mount` flag.

**Single critical blocker:** Vitest v4.1.8 requires Node.js 22+, but the runtime is Node 18.19.1. **No tests can execute.**

---

## 2. Milestone Completion vs. Plan

| Milestone | Item | Status |
|-----------|------|--------|
| **M1: Foundation** | Monorepo structure | ✅ Done |
| | Protocol message types | ⚠️ Partial — only `stat`/`read`/`write`/`readdir`/`mkdir`; missing `version`/`attach`/`walk`/`open`/`clunk` |
| | Frame codec (length-prefixed JSON) | ✅ Done |
| | TCP transport layer | ✅ Done |
| | Server + request dispatch | ✅ Done |
| | In-memory driver | ✅ Done |
| **M2: Local VFS** | `Driver` interface + `Namespace` | ✅ Done |
| | POSIX chroot driver | ✅ Done |
| | CLI: `server`, `ls`, `cat`, `write`, `mkdir` | ✅ Done |
| **M3: Remote Mount** | `NodeDOSClient` (tag-matched RPC) | ✅ Done |
| | `RemoteDriver` (Driver → RPC proxy) | ✅ Done |
| | Mount table via `Namespace` | ✅ Done |
| | Standalone `mount`/`unmount` CLI commands | ❌ Missing — only `--mount` server flag |
| | 2-node integration test | ✅ Done (`two-node.test.ts`) |
| **M4: Reliability** | Reconnect/backoff | ❌ Not implemented |
| | Authentication | ❌ Not implemented |
| | Structured error mapping | ❌ Not implemented |
| **M5: Hardening** | Concurrent client tests | ❌ Not implemented |
| | Logging | ❌ Not implemented |
| | Performance checks | ❌ Not implemented |
| **Extra** | Interactive shell (`cd`, `pwd`, `ls`, etc.) | ✅ Present (not in plan) |

---

## 3. Bugs Found

### B1 — MemoryDriver misleading error on missing path
**File:** `packages/fs-drivers/src/memory.ts:42`  
When `parentAndName()` encounters a missing intermediate path component, it throws `"Not a directory: <path>"` instead of the correct `"No such file or directory"`. The optional chaining `next?.isDir` produces `undefined` (falsy) for missing nodes.

### B2 — Handler silently drops unknown message types
**File:** `packages/server/src/handler.ts`  
The `switch` on `msg.type` has no default case. If a client sends a T-message with an unrecognized type (e.g. a future `tmove`), no response is sent and the client's pending **promise hangs forever**.

### B3 — PosixDriver symlink escape
**File:** `packages/fs-drivers/src/posix.ts:11-13`  
`path.normalize()` does not resolve symlinks. A symlink inside the chroot root pointing outside can escape the sandbox. A malicious or accidental symlink like `data -> /etc` would allow reading arbitrary files.

### B4 — MountManager client reference leak
**File:** `packages/client/src/mount.ts:12-17`  
`mountRemote()` creates a `NodeDOSClient` and `connect()`s but never stores the reference. There is no way to `disconnect()` the client on unmount, leaking the TCP connection.

### B5 — No default-case response in handler (amplifies B2)
**File:** `packages/server/src/handler.ts`  
Related to B2: even for valid but unhandled types, the dispatcher returns nothing. Every switch branch should either handle or reply with `rerror`.

---

## 4. Code Quality Issues

| Issue | File | Detail |
|-------|------|--------|
| **Silent error swallowing** | `server/src/server.ts:17-18` | Transport errors only destroy the socket with no logging |
| **CLI side-effect on import** | `cli/src/index.ts:26` | `program.parseAsync()` at module level — breaks library imports |
| **Missing protocol ops** | `protocol/src/types.ts` | No `version`/`attach`/`walk`/`open`/`clunk` messages; protocol is simplified but deviates from plan |
| **IPv6 incompatibility** | `cli/src/commands/server.ts:22` | Mount regex ``^([^=]+)=([^:]+):(\d+)$`` rejects `[::1]:9002` |
| **No linter configured** | root `package.json` | Plan references `npm run lint` but no eslint/prettier config exists |
| **Hardcoded ports in test** | `tests/integration/two-node.test.ts:7-8` | Ports 19001/19002 conflict if parallelized |
| **`isTMessage` heuristic** | `server/src/handler.ts:9` | `msg.type.startsWith("t")` is fragile — any message type starting with "t" passes |
| **Unnecessary tsconfig refs** | `shell/tsconfig.json` | References `../protocol` and `../core` but only uses `@nodedos/client` |

---

## 5. Test & Build Status

| Check | Status |
|-------|--------|
| `tsc --build` | ✅ **PASS** — all 7 packages compile |
| `tsc --build --dry` | ✅ **PASS** — all projects up to date |
| `npm run test` (vitest) | ❌ **BLOCKED** — Vitest v4.1.8 requires Node 22+; runtime is Node 18.19.1 |
| `packages/core/src/namespace.test.ts` (7 cases) | ❌ Blocked by vitest |
| `packages/fs-drivers/src/memory.test.ts` (9 cases) | ❌ Blocked by vitest |
| `tests/integration/two-node.test.ts` (5 cases) | ❌ Blocked by vitest |

**Root cause of test failure:**
```
node_modules/rolldown/... → import { styleText } from "node:util"
```
This is only available in Node.js 22+. The `package.json` specifies `"vitest": "^4.1.8"` which pulls in rolldown requiring Node 22+.

---

## 6. Recommendations

### Immediate (blocker)
1. **Downgrade vitest** to a version compatible with Node 18:
   ```json
   "vitest": "^1.6.0"
   ```
   This restores all tests without changing any test code.

### High priority
2. **Fix MemoryDriver error (B1):** Check for `undefined` explicitly before checking `isDir`:
   ```ts
   if (!next) throw new NOENTError(part);
   if (!next.isDir) throw new NOTDIRError(part);
   ```
3. **Add default case to handler (B2):** Return `rerror` for any unrecognized T-message type.
4. **Store client ref in MountManager (B4):** Track `NodeDOSClient` instances so `unmount` can disconnect.

### Medium priority
5. **Fix PosixDriver symlink escape (B3):** Use `fs.realpath` on the resolved path and verify it starts with the chroot prefix before any operation.
6. **Add IPv6 support** to mount spec parsing: either use a proper URL parser or add a second regex for `[ipv6]:port` notation.
7. **Add server error logging:** At minimum, log transport errors and unhandled exceptions to stderr.

### Low priority
8. **Add `mount`/`unmount` CLI commands** as standalone operations (not just `--mount` server flag).
9. **Add a linter** (eslint + `@typescript-eslint`) to catch the issues above automatically.
10. **Make integration test ports dynamic** (use port 0 + read assigned port) to support parallel execution.
11. **Handle backpressure** in the Transport layer: check `socket.write()` return value and implement drain logic.
12. **Add missing protocol ops** (`version`, `attach`, `walk`, `open`, `clunk`) if full 9P compatibility is desired.

### Stretch (Milestone 4/5)
13. Reconnect/backoff for remote mounts
14. Attach-time authentication
15. Error code mapping (currently all errors become `"error"`)
16. Request lifecycle logging
17. Concurrent-client stress tests
