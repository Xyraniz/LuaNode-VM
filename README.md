<div align="center"> 
<img src="logo.png" alt="LuaNode-VM logo" width="180" />
  <h1>LuaNode-VM</h1>
  <p><strong>A Lua 5.3 virtual machine and standard library implemented in JavaScript.</strong></p>
  <p>
    <a href="https://github.com/Xyraniz/LuaNode-VM/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Xyraniz/LuaNode-VM?style=flat-square" alt="MIT License" /></a>
    <a href="https://github.com/Xyraniz/LuaNode-VM"><img src="https://img.shields.io/github/languages/top/Xyraniz/LuaNode-VM?style=flat-square" alt="Top language" /></a>
    <a href="https://github.com/Xyraniz/LuaNode-VM/issues"><img src="https://img.shields.io/github/issues/Xyraniz/LuaNode-VM?style=flat-square" alt="Issues" /></a>
  </p>
</div>

LuaNode-VM is a Lua 5.3 virtual machine and standard library implemented in modern JavaScript. It runs on Node.js and keeps the public, C-shaped API used by Fengari-style integrations while exposing a canonical package entry point at `src/luanode.js`.

The project is a runtime for embedding Lua in JavaScript applications or running Lua programs from Node.js. It is separate from Lumora: LuaNode-VM targets Lua 5.3 in JavaScript, while Lumora embeds Luau in a native C++ executable.

## Highlights

- Lua 5.3 VM implemented in JavaScript without a native compilation step.

- Node.js CLI named `luanode` with script execution and `-e` inline evaluation.

- Public package entry point at `src/luanode.js`; `src/fengari.js` remains available as the compatibility entry point.

- Fengari-shaped exports for the Lua state, auxiliary library, standard library, constants, and conversion helpers.

- Lua 5.3 integer semantics with exact signed 64-bit values backed by JavaScript `BigInt`.

- Correct behavior for large integer literals, arithmetic overflow, bitwise operations, shifts, comparisons, numeric loops, table keys, `math.type`, `math.tointeger`, and `math.ult`.

- Standard Lua libraries assembled through `src/linit.js`, including base, coroutine, table, string, UTF-8, math, debug, package, I/O, OS, and Fengari integration surfaces where enabled by the implementation.

- JavaScript implementations of the VM, parser, state, objects, tables, strings, calls, debugging, loading, and dump support under `src/vm/` and the adjacent runtime files.

- A fast path for sorting dense numeric arrays while retaining custom comparator behavior.

- Tests for regression cases, integer precision, table keys, parser buffers, string formatting, CLI behavior, and the public entry point.

LuaNode-VM does not claim to be a Luau runtime. It implements the Lua 5.3 language and library model represented by this repository.

## Requirements

- Node.js 22 or another recent Node.js version compatible with the package code.

- npm for installing dependencies and running the scripts.

Install dependencies with:

```bash
npm ci
```

## Command-line usage

Run a Lua file:

```bash
npx luanode path/to/script.lua
```

Evaluate a string:

```bash
npx luanode -e "print(math.maxinteger )"
```

The CLI also supports:

```
luanode [-h|--help] [-v|--version] [-e code] [script.lua [args...]]
```

When a script file is used, the CLI preserves the invoked script path in Lua's argument table. Script arguments follow the path. With no arguments, the CLI prints its usage information rather than opening a REPL.

## Library access and untrusted scripts

The default `luaL_openlibs(L)` exposes the full standard-library set. In Node.js, this includes filesystem access through `io`, shell and process access through `os`, module loading through `package`, and VM inspection through `debug`. The CLI uses this full profile; scripts should be treated as trusted host code.

An embedding that does not need those host interfaces can open the reduced library set:

```js
lualib.luaL_openlibs(L, { hostAccess: false });
```

This omits `io`, `os`, `package`, `debug`, and `fengari`, and removes `dofile` and `loadfile` from the base library. `print` remains available. This option reduces exposed capabilities; it is not a security sandbox and does not impose CPU or memory limits. Use process or OS isolation and resource limits for untrusted scripts.

The Lua-level collector handles table and userdata reachability, weak table entries, and object finalizers. Its `collectgarbage("count")` value estimates managed Lua object storage; it is not a measurement of the complete JavaScript heap. `collectgarbage("step")` runs one synchronous full pass.

The package scripts provide equivalent shortcuts:

```bash
npm run cli -- path/to/script.lua
npm run smoke
```

## JavaScript embedding

The canonical entry point is:

```
const fengari = require("./src/luanode.js");
```

It re-exports the Fengari-shaped API from `src/fengari.js`, including the `lua`, `lauxlib`, and `lualib` namespaces. Existing consumers that import `src/fengari.js` can continue to use that path.

A typical embedding follows the familiar Lua C-API-shaped flow exposed by the JavaScript modules:

```
const { lua, lauxlib, lualib } = require("./src/luanode.js");

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);
// Load and execute Lua code through the exported lauxlib/lua functions.
```

The exact API is intentionally shaped like Fengari rather than like a new object-oriented wrapper. Applications should use the exports in `src/luanode.js`, `src/lua.js`, `src/lauxlib.js`, and `src/stdlib/lualib.js` as the source of truth.

## Integer behavior

JavaScript's ordinary `Number` type cannot represent every integer in Lua 5.3's signed 64-bit range. LuaNode-VM therefore keeps integer values as exact 64-bit quantities and converts between numeric representations according to Lua 5.3 rules.

```bash
node cli/luanode.js -e \
  'print(math.maxinteger); print(math.maxinteger + 1); print(9007199254740993)'
```

The expected values are:

```
9223372036854775807
-9223372036854775808
9007199254740993
```

This behavior is also exercised by the integer tests and the manual stress battery. It includes exact large integer table keys and `string.pack`/`string.unpack` round trips for 64-bit integers.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/luanode.js` | Canonical package entry point. |
| `src/fengari.js` | Fengari-shaped public compatibility entry point. |
| `src/fengaricore.js` | Runtime conversion helpers and Fengari metadata. |
| `src/lua.js`, `src/lauxlib.js` | Lua API and auxiliary API layers. |
| `src/stdlib/` | Lua standard-library implementations and library initialization. |
| `src/vm/` | Parser, bytecode, VM execution, state, objects, tables, strings, debugging, and loading internals. |
| `cli/luanode.js` | Node.js command-line runner. |
| `tests/` | Jest tests and manual Lua checks. |
| `bench/runtime.lua` | Small runtime benchmark program. |
| `conformance/` | Lua 5.3 conformance material and recorded outputs. |

## Tests and development commands

Run the Jest suite:

```bash
npm test
```

Run it serially when reproducing a failure:

```bash
npm test -- --runInBand
```

Run linting and coverage:

```bash
npm run lint
npm run test:coverage
```

Run the benchmark:

```bash
npm run benchmark
```

The checked test suite covers 184 tests across 13 suites. ESLint applies the shared source rules to `cli/` as well as `src/`; the existing codebase still reports warnings, while `npm run lint` exits successfully when there are no errors.

## Compatibility and boundaries

LuaNode-VM carries code and public shapes derived from the Fengari/Lua ecosystem, with the applicable copyright and license notices retained in the source tree. The project changes the runtime's integer representation and behavior to support exact signed 64-bit Lua 5.3 integers; it should not be described as a drop-in replacement for every Fengari implementation detail without testing the target integration.

The VM is implemented in JavaScript and is designed to be embedded or executed through Node.js. Browser bundling, host I/O policy, and application-specific integration remain responsibilities of the consuming application.

## License

LuaNode-VM is distributed under the MIT License. See [LICENSE](LICENSE) for the complete text.
