# NodeDOS — ISO Inspection Report & Recommendations
**Inspected:** 2026-06-06  
**ISO size:** 56MB | **Rootfs:** 20MB cpio.gz | **Files in rootfs:** 494  
**Stack:** Linux 6.11.11 + BusyBox + Node.js | Bootloader: GRUB (BIOS + UEFI)

---

## What's Actually in the ISO

| Path | Description |
|---|---|
| `/boot/bzImage` | Linux 6.11.11 kernel |
| `/boot/rootfs.cpio.gz` | 20MB initramfs — entire userspace |
| `/boot/grub/grub.cfg` | 2 menu entries: normal + verbose |
| `/efi/boot/bootx64.efi` | UEFI bootloader |
| `/nodedos/bundle.js` | ~39KB bundled TypeScript output |
| `/nodedos/init.js` | PID 1 entry point — starts server + shell |
| `/init` | Shell script: mounts proc/sys/dev, brings up loopback, execs Node |

**Userspace:** BusyBox (ash, vi, ps, mount, ping, etc.) + Node.js. Clean and minimal.

---

## Confirmed Bugs (with Fixes)

### 🔴 BUG 1 — `exit` causes kernel panic (KNOWN)
**Location:** `bundle.js` → shell exit handler + `init.js` shutdown()

**Root cause:** Shell calls `process.exit(0)`. Node is PID 1. When PID 1 exits without handing off to init, the kernel panics — there's nothing left to reap processes.

**Current code (init.js):**
```js
function shutdown(server) {
  server.close();
  console.log('\nNodeDOS halted.');
  process.exit(0);  // ← PANIC when PID 1
}
```

**Fix — init.js:**
```js
function shutdown(server) {
  server.close();
  console.log('\nNodeDOS halted.');
  if (process.pid === 1) {
    require('child_process').execFileSync('/sbin/halt', ['-f'], { stdio: 'inherit' });
  } else {
    process.exit(0);
  }
}
```

**Also fix bundle.js shell exit handler:**
```js
case "exit":
case "quit":
  rl.close();
  // Don't call process.exit() directly — let init.js shutdown() handle it
  process.emit('SIGTERM');
  break;
```

Rebuild only rootfs after this fix (fast — no kernel recompile needed).

---

### 🔴 BUG 2 — `write` does not truncate (KNOWN)
**Location:** `bundle.js` → `MemoryDriver.write()` (the in-ISO driver)

**Root cause:** The write implementation only extends or overwrites the buffer — it never truncates. Writing "hi" over "hello world" leaves "hi\0lo world" in memory.

**Current code:**
```js
async write(path, offset, data) {
  const end = offset + data.length;
  if (end > node.content.length) {
    const extended = Buffer.alloc(end);
    node.content.copy(extended);
    node.content = extended;
  }
  data.copy(node.content, offset);  // ← no truncation
  node.mtime = Date.now();
  return data.length;
}
```

**Fix:** When writing at offset 0, truncate to the new content length:
```js
async write(path, offset, data) {
  const end = offset + data.length;
  if (end > node.content.length) {
    const extended = Buffer.alloc(end);
    node.content.copy(extended);
    node.content = extended;
  }
  data.copy(node.content, offset);
  // Truncate if this write ends before current content end
  if (offset === 0) {
    node.content = node.content.subarray(0, end);
  }
  node.mtime = Date.now();
  return data.length;
}
```

A proper `ttruncate` message type would be the real fix long-term.

---

### 🟡 BUG 3 — No reconnect/backoff for remote mounts
**Location:** `bundle.js` — zero mentions of `reconnect`

When a remote node drops, the TCP connection dies and the client errors out permanently. There's no retry loop anywhere in the codebase.

**Fix approach:** Wrap `NodeDOSClient` in a reconnect decorator:
```js
async function connectWithRetry(host, port, retries = 5, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await NodeDOSClient.connect(host, port);
    } catch (err) {
      if (i === retries - 1) throw err;
      console.error(`[mount] Connection failed, retry ${i+1}/${retries}...`);
      await new Promise(r => setTimeout(r, delay * Math.pow(2, i))); // exponential backoff
    }
  }
}
```

---

### 🟡 BUG 4 — Hostname is "buildroot" (cosmetic but wrong)
**Location:** `/etc/hostname` in rootfs

The hostname reads `buildroot` — the Buildroot default. Should be `nodedos`.

**Fix:** In `iso/nodedos_defconfig` or the rootfs overlay, add:
```
echo "nodedos" > /etc/hostname
```

Also update `/etc/issue`:
```
NodeDOS v0.1.0 — Plan 9-inspired Distributed OS
```

---

### 🟡 BUG 5 — GRUB timeout is 3 seconds with no splash
**Location:** `/boot/grub/grub.cfg`

3 seconds is enough time to miss the menu. No splash art either. Minor UX issue.

**Fix:**
```
set timeout=5
set default=0
# Optional: add a graphical theme or ASCII splash via GRUB's echo
```

---

## Ideas & Enhancements

### 💡 IDEA 1 — `ttruncate` message type
The protocol currently has tstat/tread/twrite/treaddir/tmkdir. Add `ttruncate` to allow explicit file size control — this enables proper overwrite semantics and is consistent with Plan 9's `Twrite` + truncation model.

---

### 💡 IDEA 2 — Persistent storage via loop-mounted ext4
Right now the entire FS is in memory — it vanishes on reboot. A small ext4 image embedded in the ISO (or mounted from a companion disk) would give NodeDOS persistent user files. GRUB can pass a second initrd or a data image.

---

### 💡 IDEA 3 — `mount` command in the shell
Currently you can only mount remote nodes at server startup via `--mount /prefix=host:port`. Adding a runtime `mount` shell command would make NodeDOS feel much more like Plan 9's `bind` and `mount` experience:
```
nodedos> mount /remote localhost:9002
nodedos> ls /remote
```

---

### 💡 IDEA 4 — Token-based auth (simple shared secret)
No auth means anyone on the same network can read/write your namespace. A simple HMAC shared secret in the handshake would be enough for v0.2 — not production security, but better than nothing and consistent with the "minimal OS" aesthetic.

---

### 💡 IDEA 5 — `history` command in the shell
The REPL has no command history (no readline history persistence). Adding `.nodedos_history` at `~/.nodedos_history` written at shutdown and loaded at startup would massively improve day-to-day usability.

---

### 💡 IDEA 6 — Shrink the ISO
At 56MB, most of the weight is GRUB locale files and x86_64-EFI modules. Stripping unused GRUB modules and locales could bring the ISO down to ~20-25MB. A hybrid BIOS-only ISO could go even smaller (~12MB). If the target is GNOME Boxes/QEMU only, UEFI isn't strictly needed.

---

### 💡 IDEA 7 — `dmesg` alias or boot log in shell
Running `dmesg` works via BusyBox but isn't surfaced as a NodeDOS shell command. A `syslog` or `dmesg` built-in would help with debugging mounted node issues.

---

## Priority Order for Next Session

| Priority | Task | Effort |
|---|---|---|
| 🔴 P0 | Fix kernel panic on `exit` (init.js + bundle.js) | 30 min |
| 🔴 P1 | Fix write truncation bug | 30 min |
| 🟡 P2 | Fix hostname to "nodedos" | 5 min |
| 🟡 P3 | Add reconnect/backoff for remote mounts | 2 hrs |
| 💡 P4 | Add `mount` shell command | 2 hrs |
| 💡 P5 | Shell history persistence | 1 hr |
| 💡 P6 | Add `ttruncate` protocol message | 3 hrs |
| 💡 P7 | Shrink ISO (strip GRUB bloat) | 1 hr |

---

## How to Rebuild After Source Fixes

Only the rootfs needs rebuilding for all bugs above (no kernel changes):

```bash
cd ~/buildroot
# Edit overlay files for hostname/init fixes
make nodedos_defconfig
make  # or: make -j$(nproc) for speed
# Output: output/images/nodedos.iso
```

The P0 fix (kernel panic) only requires editing `init.js` and `bundle.js` in the rootfs overlay and running `make`. No kernel recompile — should take ~5-10 minutes.
