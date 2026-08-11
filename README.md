<p align="center">
<img src="logo.png" alt="LuaNode VM Logo" width="160" />
</p>

# LuaNode VM (`luanode-vm`)

> **An enhanced, modern JavaScript runtime and Virtual Machine for Lua 5.3, built as a specialized fork of Fengari with robust 64-bit integer support and active compatibility improvements for Node.js and web browsers.**

## Overview

`LuaNode VM` is an open-source JavaScript execution environment for Lua bytecode and source scripts, derived and improved from the foundational architecture of **Fengari**. While Fengari achieved an impressive transpilación of Lua to ES6, its historical design limited integer widths to 32 bits and left certain modern runtime adjustments pending.

`LuaNode VM` builds upon this solid foundation by introducing native 64-bit safe integer arithmetic (`Number.MAX_SAFE_INTEGER`), widening bytecode serialization structures, and maintaining active compatibility updates for contemporary Node.js and browser environments. It bridges the gap between high-level scripting languages and modern JavaScript runtimes with improved precision and active maintenance.

---

## Key Enhancements & Features

- **True 64-Bit Integer Support (****`lua_Integer`****)**: Unlike the 32-bit limitation in baseline Fengari, LuaNode-VM upgrades integer handling to utilize the full 53-bit safe integer range of JavaScript (`±9,007,992,547,409,91`), ensuring full compliance with Lua 5.3 expectations for `math.maxinteger` and large numerical operations.

- **Upgraded Bytecode Serialization**: Modifies `ldump.js` and `lundump.js` to serialize and deserialize 64-bit integers across 8-byte boundaries using combined 32-bit high and low words.

- **Active Maintenance & Modern Tooling**: Regularly updated dependency graphs, modern ESLint configurations, and active refactoring tailored for current Node.js runtimes.

- **Universal Cross-Environment Execution**: Operates natively in both modern Node.js environments and standard web browsers with identical API structures and execution semantics.

- **Familiar C-Compatible JS API**: Preserves the intuitive JavaScript API mirroring traditional C-API conventions (`lua_State`, stack manipulation, and library loading) established by Fengari.

---

## Architectural Origin & Transparency

`LuaNode VM` is explicitly a **specialized fork of Fengari** (`fengari-lua/fengari`). We believe in radical transparency:

- The core virtual machine architecture, lexical parser, and module organization (`fengaricore`, `lapi`, `lvm`, etc.) originate from the excellent work of the Fengari team.

- LuaNode-VM focuses its independent development on numerical precision (64-bit integers), modern runtime compatibility, and continuous maintenance.

---

## Installation & Quick Start

Clone the repository and install the necessary dependencies using your preferred package manager:

```bash
git clone https://github.com/Xyraniz/luanode-vm.git
cd luanode-vm
npm install
```

### Basic JavaScript Integration Example

To initialize a Lua state, load standard libraries, and execute operations from JavaScript, use the following pattern:

```javascript
const luanode = require('./src/fengari.js' );

const lauxlib = luanode.lauxlib;
const lualib  = luanode.lualib;
const lua     = luanode.lua;

// Initialize a new execution state
const L = lauxlib.luaL_newstate();

// Load standard Lua libraries
lualib.luaL_openlibs(L);

// Push a value onto the virtual stack
lua.lua_pushliteral(L, "Initialized LuaNode VM successfully.");
```

---

## Running the Test Suite

`LuaNode VM` includes an extensive testing framework powered by Jest to guarantee execution stability and prevent regressions across updates:

```bash
npm test
```

---

## License

This project is open-source software licensed under the **MIT License**. See the [LICENSE](LICENSE) file for complete details.
