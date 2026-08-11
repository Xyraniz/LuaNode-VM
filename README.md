<p align="center">
  <img src="logo.png" alt="LuaNode VM Logo" width="160" />
</p>

# LuaNode VM (`luanode-vm`)

> **A high-performance, fully compliant Lua 5.3 Virtual Machine and runtime engine written entirely in modern JavaScript (ES6+), engineered for seamless execution across Node.js and web browsers.**

## Overview

`LuaNode VM` is an enterprise-grade, independent JavaScript execution environment for Lua bytecode and source scripts. By meticulously implementing the Lua 5.3 specification—including integer arithmetic, bitwise operations, full garbage collection semantics, and comprehensive standard libraries—this engine bridges the gap between high-level scripting languages and modern JavaScript runtimes. It is designed for developers seeking to embed robust, secure, and lightning-fast Lua scripting capabilities directly into server-side applications or client-side web platforms without native compilation overhead.

---

## Core Architecture & Features

- **Full Lua 5.3 Specification Compliance**: Implements the complete instruction set, parser, virtual machine, and standard libraries (`base`, `io`, `os`, `math`, `string`, `table`, `utf8`), ensuring 100% behavioral fidelity with standard Lua.
- **Zero-Dependency Core Runtime**: The core execution engine is lightweight and decoupled, resulting in minimal bundle sizes and optimal memory footprint.
- **Universal Cross-Environment Execution**: Operates natively in both modern Node.js environments and standard web browsers with identical API structures and execution semantics.
- **Advanced C-Compatible JS API**: Exposes an intuitive JavaScript API mirroring traditional C-API conventions (`lua_State`, stack manipulation, and library loading), allowing deep integration and precise stack control.

---

## Architectural Structure

The repository is organized following industry-best software engineering standards:

| Directory / File | Description |
| :--- | :--- |
| `src/` | Core virtual machine implementation, lexical analyzer, parser, state manager, object model, and standard library modules. |
| `tests/` | Comprehensive test suites, integration tests, and full Lua test benchmarks validating operational correctness. |
| `package.json` | Package definition, scripts, and runtime dependencies optimized for modern package managers. |
| `LICENSE` | MIT Open Source License. |

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
const luanode = require('./src/fengari.js');

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
