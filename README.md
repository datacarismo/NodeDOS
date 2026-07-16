# NodeDOS

A distributed operating system inspired by [Plan 9](https://en.wikipedia.org/wiki/Plan_9_from_Bell_Labs). Each node exposes its local filesystem over TCP and can transparently mount other NodeDOS nodes into a unified namespace — boot it from an ISO, run it in a VM, or use it as a CLI tool on any Linux/Mac/Windows machine.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

---

## What it does

```
Node A (port 9001)               Node B (port 9002)
/  → /tmp/nodeA  (local disk)    /  → /tmp/nodeB  (local disk)
/remote → localhost:9002 ────────┘
```

A client talking to Node A can read and write files on Node B at `/remote/*` without knowing B exists. Mounts are transparent — the same `ls`, `cat`, and `write` commands work whether a path is local or remote.

---

## Quick Start

**Requirements:** Node.js 18+, npm 8+

```bash
git clone https://github.com/datacarismo/NodeDOS.git
cd NodeDOS
npm install
npm run build
npm link --workspace=@nodedos/cli   # puts `nodedos` in your PATH
```

### Interactive shell

```bash
# Start a server
nodedos server --port 9001 --root /tmp/mynode

# Open the interactive shell (in another terminal)
nodedos
```

```
  ███╗   ██╗ ██████╗ ██████╗ ███████╗██████╗  ██████╗ ███████╗
  ...
  v0.1.0  —  Plan 9-inspired Distributed Operating System

NodeDOS Shell  [server: localhost:9001]
Type "help" for available commands.

nodedos:/> ls /
nodedos:/> mkdir /docs
nodedos:/> write /docs/hello.txt "hello world"
nodedos:/> cat /docs/hello.txt
hello world
nodedos:/> exit
```

### Shell commands

| Command | Description |
|---------|-------------|
| `ls [path]` | List directory (default: current directory) |
| `cat <path>` | Print file contents |
| `write <path> <content>` | Write content to file |
| `mkdir <path>` | Create directory |
| `rm <path>` | Remove file or empty directory |
| `mv <from> <to>` | Rename/move within one node |
| `truncate <path> <size>` | Set file size (extends with zeros) |
| `cd <path>` | Change directory |
| `pwd` | Print current directory |
| `server <host:port>` | Switch to a different server |
| `help` | Show all commands |
| `exit` | Exit the shell |

### One-shot CLI commands

```bash
nodedos server  --port 9001 --root /tmp/nodeA [--mount /prefix=host:port ...]
nodedos ls      <path>    [--server host:port]
nodedos cat     <path>    [--server host:port]
nodedos write   <path> <content>  [--server host:port]
nodedos mkdir   <path>    [--server host:port]
nodedos rm      <path>    [--server host:port]
nodedos mv      <from> <to>       [--server host:port]
```

---

## Multi-Node Example

```bash
mkdir -p /tmp/nodeA /tmp/nodeB

# Terminal 1 — start node B
nodedos server --port 9002 --root /tmp/nodeB

# Terminal 2 — start node A, mounting B at /remote
nodedos server --port 9001 --root /tmp/nodeA --mount /remote=localhost:9002

# Terminal 3 — use the shell on node A
nodedos

nodedos:/> write /remote/hello.txt "written through the mount"
nodedos:/> cat /remote/hello.txt
written through the mount
nodedos:/> ls /remote
-         25  hello.txt
```

The file physically lands on node B's disk at `/tmp/nodeB/hello.txt`.

If node B goes down, operations under `/remote` fail with an error instead of hanging, and node A redials B with exponential backoff — once B is back, the mount works again with no restart.

---

## Bootable ISO

NodeDOS can boot as a standalone operating system on bare metal or in a VM (GNOME Boxes, QEMU, VirtualBox). Node.js runs as PID 1 — there is no bash, no systemd, no package manager. Just the kernel and NodeDOS.

### Build the ISO

**Requirements:** Buildroot 2024.11+, `grub-mkrescue`, `xorriso`, `mtools`

```bash
# Install build deps (Ubuntu/Debian)
sudo apt install grub-pc-bin grub-efi-amd64-bin xorriso mtools gawk libncurses-dev libelf-dev

# Download Buildroot
wget https://buildroot.org/downloads/buildroot-2024.11.1.tar.gz
tar xf buildroot-2024.11.1.tar.gz -C ~/ && mv ~/buildroot-2024.11.1 ~/buildroot

# Build
./iso/build.sh
# Output: nodedos.iso (~56MB)
```

### Test in QEMU

```bash
qemu-system-x86_64 -cdrom nodedos.iso -m 256M
```

### Write to USB

```bash
sudo dd if=nodedos.iso of=/dev/sdX bs=4M status=progress && sync
```

### Boot screen

```
  NODEDOS

  v0.1.0  —  Plan 9-inspired Distributed Operating System

  [init] Running as PID 1
  [init] Root filesystem : /
  [init] Server port     : 9001
  [init] NodeDOS server ready

NodeDOS Shell  [server: localhost:9001]
nodedos:/>
```

---

## Architecture

```
packages/
  protocol/     FrameCodec (length-prefixed JSON), Transport, message types
  core/         Driver interface, Namespace (longest-prefix mount table)
  fs-drivers/   MemoryDriver (in-memory), PosixDriver (chrooted local disk)
  server/       NodeDOSServer (TCP accept loop), message dispatcher
  client/       NodeDOSClient (tag-matched RPC), RemoteDriver, MountManager
  shell/        Interactive REPL shell
  cli/          Commander.js entry point and per-command files

init/
  index.js      PID 1 entry point for the bootable ISO

iso/
  build.sh          ISO build script
  nodedos_defconfig Buildroot config (x86_64, BusyBox, Node.js, no systemd)
  grub.cfg          GRUB boot menu
  overlay/          Files merged into the rootfs at build time
```

The protocol uses request/response pairs tagged with a numeric ID so multiple in-flight requests share one TCP connection. File content is base64-encoded inside JSON frames.

---

## Development

```bash
npm test           # run all tests
npm run test:watch # watch mode
npm run typecheck  # type-check without emitting
npm run build      # compile TypeScript
```

Test coverage:
- **Namespace** — mount/unmount/resolve, prefix shadowing, boundary matching
- **MemoryDriver** — stat, read, write, readdir, mkdir, error cases
- **Two-node integration** — real TCP, write through a mount, ls through a mount

---

## Known Limitations

- **No authentication** — any client that can reach the TCP port has full read/write access.
- **Mount at startup only** — hot-mount/unmount requires a server restart.

---

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).
