# LuaNode-VM

> A Lua 5.3 virtual machine implemented in modern JavaScript, with a hybrid `Number`/`BigInt` representation for the complete signed 64-bit `lua_Integer` range.

LuaNode-VM is a JavaScript implementation of the Lua 5.3 virtual machine and standard libraries. It originated from the Fengari architecture, while extending and correcting the integer model, VM behavior, tables, garbage-collection observables, standard libraries, file I/O, bytecode loading, and compatibility diagnostics.

This README is intentionally explicit about the comparison with Fengari and about the conformance metric. It does **not** claim that a count of source files is a count of tests. The official Lua test suite is a collection of Lua scripts containing direct assertions, helper functions, loops, and repeated checks; it does not emit a canonical unique-test identifier for every assertion.

## What is different from Fengari?

Fengari is a respected Lua 5.3 VM written in JavaScript. Its own documentation states that JavaScript numbers are IEEE-754 doubles and that Fengari therefore uses the PUC-Rio configuration with 32-bit integers. The same documentation also lists limitations or unavailable features, including its reliance on the JavaScript garbage collector rather than an implementation of `lua_gc`, weak tables and `__gc` metamethods, and several I/O functions. These statements are taken from Fengari's public documentation, not inferred from a benchmark or from this project's claims [1].

LuaNode-VM keeps the C-API-shaped JavaScript architecture while implementing a full signed 64-bit integer model with `BigInt` support. Values that remain within JavaScript's safe integer range can use `Number`; values outside that range are represented exactly with `BigInt` and normalized to signed 64-bit values.

| Capability | Fengari's documented configuration | LuaNode-VM in this repository |
|---|---|---|
| Integer maximum | `2147483647` in the documented 32-bit configuration | `9223372036854775807` |
| Integer minimum | `-2147483648` in the documented 32-bit configuration | `-9223372036854775808` |
| `9007199254740993` | Cannot be represented exactly by a JavaScript `Number`-only integer path | Preserved as the exact integer `9007199254740993` |
| Integer overflow width | 32-bit two's-complement behavior | 64-bit two's-complement behavior modulo `2^64` |
| `MININTEGER // -1` | Must be tested against the implementation in use | Returns `MININTEGER`, matching PUC-Rio Lua 5.3's special case |
| Weak tables and finalization | Listed as missing in Fengari's public README | Implemented and exercised by the Lua conformance tests |
| `collectgarbage` observability | Fengari documents reliance on the JavaScript GC | LuaNode-VM exposes Lua-level collection state and deterministic table-level collection behavior |
| Portable file I/O | Fengari documents several I/O functions as unavailable or partial | `io.open`, read/write, seek, lines, buffering, and `io.tmpfile` are implemented for the tested Node.js environment |
| Bytecode integer constants | Subject to the implementation's integer representation | Dump/load preserves eight-byte little-endian integer constants |

This table is a compatibility summary, not a performance benchmark. It should be verified by running the commands in the [Verification](#verification) section.

## Luau compatibility decision

LuaNode-VM deliberately targets **Lua 5.3**, not Luau. Luau is based on Lua 5.1 and has its own parser, multi-pass compiler, bytecode format, optimized interpreter, sandboxing model, and language extensions such as type annotations, `continue`, compound assignments, `const`, generalized iteration, and `if` expressions [5] [6] [7]. Its compatibility documentation also explicitly chooses not to provide Lua 5.3's first-class 64-bit integer type and bitwise operators [5]. Therefore, accepting a few Luau tokens in this parser would not create real Luau compatibility; it would create an ambiguous dialect with mismatched runtime semantics.

The strong engineering path is to keep this repository as a rigorous Lua 5.3 runtime and, if Luau becomes a product requirement, add a separate optional backend or adapter behind an explicit API boundary. That preserves the exact-int64 and conformance advantages here instead of weakening them in an attempt to emulate two incompatible language contracts.

## Performance work

The runtime now has a specialized dense-numeric `table.sort` path that copies values out of the Lua table, compares integer and float `TValue` values without re-entering the VM, and writes them back through raw table primitives. The general path remains in place for tables with metamethods or custom comparators. The common safe-integer arithmetic path also avoids `BigInt` allocation unless an operation leaves the JavaScript safe-integer range.

The benchmark is intentionally small and reproducible rather than a universal performance claim:

```bash
npm run benchmark
```

To compare against Fengari in a temporary directory:

```bash
mkdir -p /tmp/fengari-compare
cd /tmp/fengari-compare
npm init -y
npm install fengari fengari-node-cli
npx fengari /path/to/LuaNode-VM/bench/runtime.lua
```

Run both commands on the same machine, Node.js version, and workload. The benchmark covers arithmetic, numeric table indexing, field access, Lua calls, and dense numeric sorting. It is expected that LuaNode-VM's strongest advantage is the exact-int64 and compatibility surface; performance numbers must be reported as workload-specific measurements rather than as a blanket claim.

## Integer semantics

The implementation uses a hybrid representation:

1. Safe integer values can remain JavaScript `Number` values for the fast path.
2. Values outside the safe range use `BigInt` while remaining within signed 64-bit limits.
3. Arithmetic and bitwise operations normalize results with 64-bit two's-complement rules.
4. Large table keys remain distinct; `2^53` and `2^53+1` do not collide.
5. Hexadecimal parsing, string formatting, packing, unpacking, bytecode serialization, API conversion, and library indexes preserve the full int64 range.
6. Lua 5.3's special integer rules are preserved: `MININTEGER // -1` returns `MININTEGER`, while `MININTEGER % -1` returns zero.

Examples:

```lua
print(math.maxinteger)                         -- 9223372036854775807
print(math.mininteger)                         -- -9223372036854775808
print(math.maxinteger + 1)                     -- -9223372036854775808
print(math.mininteger - 1)                     -- 9223372036854775807
print(9007199254740993)                        -- 9007199254740993
print(math.mininteger // -1)                   -- -9223372036854775808
print(math.mininteger % -1)                    -- 0
print(string.format("%d", math.maxinteger))   -- 9223372036854775807
```

## Main implementation areas

The changes exercised by the Lua 5.3 conformance suite include the following areas.

| Area | Implemented behavior |
|---|---|
| VM arithmetic | Mixed integer/float equality and ordering, int64 arithmetic, floor division, modulo, and bitwise operations. |
| Tables | Weak keys/values, ephemeron fixed points, finalizers, raw table-library access, and exact numeric key canonicalization. |
| Collection | `collectgarbage` state operations and deterministic Lua-level table collection integrated with VM execution. |
| Strings | Large indexes, `%f`, `%a`/`%A`, signed unpacking, exact `cN` lengths, and pack overflow checks. |
| Math | Exact integer conversion and int64-safe `math.random` ranges. |
| I/O | File opening, reading, writing, seeking, line iteration, buffering modes, `io.tmpfile`, and file-handle lifecycle behavior. |
| Loader | Binary chunk detection after comments containing NUL bytes and full-width integer constants. |
| Diagnostics | Lua-compatible C-function information, stack-overflow wording, parser-level limits, and expression complexity errors. |

## Installation

```bash
git clone https://github.com/Xyraniz/LuaNode-VM.git
cd LuaNode-VM
npm install
```

The CLI entry point is:

```bash
node cli/luanode.js script.lua arg1 arg2
```

A quick smoke test is:

```bash
node cli/luanode.js -e 'print(math.maxinteger); print(math.maxinteger + 1)'
```

## JavaScript API

```javascript
const F = require("./src/luanode.js");
const { lua, lauxlib, lualib, to_luastring } = F;

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

const code = to_luastring(`
    print("math.maxinteger =", math.maxinteger)
    print("math.mininteger =", math.mininteger)
    print("overflow =", math.maxinteger + 1)
`);

if (lauxlib.luaL_loadstring(L, code) === lua.LUA_OK)
    lua.lua_pcall(L, 0, 0, 0);
```

## Verification

### 1. Existing Jest regression suite

Run the five repository test files explicitly. Explicit paths are used because a delivery directory containing complete copies of tests can otherwise be discovered by Jest as a second set of suites.

```bash
npx jest --runInBand --runTestsByPath \
  tests/int64.test.js \
  tests/lexer-buffer.test.js \
  tests/regression.test.js \
  tests/string-format.test.js \
  tests/table-keys.test.js \
  tests/table-sort-fast.test.js
```

The final verification in this repository produced:

```text
Test Suites: 7 passed, 7 total
Tests:       154 passed, 154 total
```

### 2. Official PUC-Rio Lua 5.3 test suite

The tested archive is `conformance/lua-5.3.0-tests.tar.gz`. Its SHA-256 is:

```text
0c1ff46bf7d950023a189e32a6ce3fe83bc2fbce28187cc9b38ba056c733b267
```

Run the portable configuration used for the documented result:

```bash
cd conformance/lua-5.3.0-tests
node --expose-gc ../../cli/luanode.js \
  -e '_U=true; dofile("run_all.lua")'
```

`_U=true` is defined by the official launcher as the portable/user-test mode. It enables `_soft`, `_port`, and `_nomsg`, which avoids host-specific POSIX checks while retaining the portable language, VM, library, error, math, table, I/O, date, and binary-chunk checks.

The clean final run ended with:

```text
final OK !!!
```

The official launcher prints 24 `***** FILE` markers. It also executes `strings.lua` and `literals.lua` through `olddofile`, so the complete run loads **26 official Lua scripts**. All 26 completed without an exception.

### 3. Correct conformance metric

The suite does not provide a canonical unique-test count. A file count is therefore not presented as a test count. For an additional dynamic measurement, the native Lua `assert` implementation was instrumented temporarily in the JavaScript runtime without changing its arguments, return values, or error behavior. The instrumentation was then removed.

The portable run observed:

```text
NATIVE_ASSERT_COUNT=70715
final OK !!!
```

This means **70,715 dynamic `assert` invocations were observed and zero failed before the suite reached its final success marker**. The honest statement is:

> LuaNode-VM completed 26/26 official scripts and observed 70,715/70,715 dynamic assertion checks passing in the portable run. This is not claimed to be 70,715 unique tests or a replacement for an official per-test identifier.

The raw final output is preserved in `conformance/full-suite-clean-final.stdout`; the dynamic measurement is preserved in `conformance/native-assert-js-counter.stdout`.

## Reproducing the comparison with Fengari

Fengari's official repository describes it as a Lua VM written in JavaScript and states that its integer configuration uses 32-bit integers because JavaScript numbers cannot accurately represent integers above 53 bits [1]. Its Node CLI is a separate package that provides `fengari` and `fengaric` command-line applications [2].

A clean comparison can be run in a temporary directory without modifying this repository:

```bash
mkdir -p /tmp/fengari-compare
cd /tmp/fengari-compare
npm init -y
npm install fengari fengari-node-cli
npx fengari -e 'print(math.maxinteger); print(math.mininteger); print(9007199254740993)'
```

Then run the same probe with LuaNode-VM from its repository root:

```bash
cd /path/to/LuaNode-VM
node cli/luanode.js -e 'print(math.maxinteger); print(math.mininteger); print(9007199254740993)'
```

The expected distinction, based on the current public Fengari documentation and the tested LuaNode-VM implementation, is that Fengari reports the documented 32-bit integer limits while LuaNode-VM reports the full signed 64-bit limits and preserves `9007199254740993` exactly. Always run both commands rather than relying solely on this README.

For a source-level check of the Fengari configuration:

```bash
cd /tmp/fengari-compare
npm view fengari version
npm root -g 2>/dev/null || true
```

The authoritative comparison sources are linked below. The result is intended to be independently testable, not accepted merely because this project claims it.

## Test artifacts and paths

The repository keeps the official suite and final raw outputs under `conformance/`. The clean ZIP delivery preserves the repository-relative paths directly: copy its contents into the repository root and the files will land under `src/`, `tests/`, and `conformance/` as shown. No machine-specific absolute path is required, and no separate changelog is included in that delivery.

The relevant repository-relative paths are:

```text
README.md
src/lauxlib.js
src/stdlib/lbaselib.js
src/stdlib/liolib.js
src/stdlib/lmathlib.js
src/stdlib/loadlib.js
src/stdlib/loslib.js
src/stdlib/lstrlib.js
src/stdlib/ltablib.js
src/vm/lapi.js
src/vm/lcode.js
src/vm/ldebug.js
src/vm/ldo.js
src/vm/lint64.js
src/vm/lobject.js
src/vm/lparser.js
src/vm/ltable.js
src/vm/lvm.js
tests/int64.test.js
tests/regression.test.js
conformance/lua-5.3.0-tests.tar.gz
conformance/full-suite-clean-final.stdout
conformance/full-suite-clean-final.stderr
conformance/native-assert-js-counter.stdout
conformance/native-assert-js-counter.stderr
conformance/jest-explicit-final.stdout
conformance/jest-explicit-final.stderr
```

The complete ZIP inventory is supplied separately as a plain-text file named `PATHS.txt`. Its entries are relative paths such as `src/vm/ltable.js`, not paths from the build machine.

## Project structure

```text
LuaNode-VM/
âââ src/
â   âââ fengari.js
â   âââ lua.js
â   âââ lauxlib.js
â   âââ lualib.js
â   âââ stdlib/
â   âââ vm/
âââ tests/
âââ conformance/
â   âââ lua-5.3.0-tests/
â   âââ lua-5.3.0-tests.tar.gz
â   âââ final output artifacts
âââ cli/
â   âââ luanode.js
âââ package.json
âââ README.md
```

## Project origin and scope

LuaNode-VM is a specialized derivative of the Fengari architecture. The project acknowledges that the VM organization, C-API-shaped JavaScript surface, parser lineage, and standard-library layout originate from Fengari and the broader Lua porting work. The independent work documented here focuses on exact 64-bit integer behavior, conformance-driven VM and library corrections, deterministic Lua-level table collection, Node.js file I/O, binary chunk handling, and reproducible testing.

The conformance result is not a claim that LuaNode-VM and Fengari are identical in every environment. It is a documented result for the portable PUC-Rio Lua 5.3 test run in this repository, plus the explicitly listed Jest regression tests. Platform-specific POSIX behavior remains a separate concern.

## License

LuaNode-VM is distributed under the MIT License. See [LICENSE](LICENSE). Fengari is also MIT-licensed; see its official repository for the original project and licensing information.

## References

[1]: https://github.com/fengari-lua/fengari "Fengari official repository and documented semantics"

[2]: https://github.com/fengari-lua/fengari-node-cli "Fengari Node.js command-line interface"

[3]: https://www.lua.org/tests/ "Official Lua test suites"

[4]: https://www.lua.org/manual/5.3/manual.html "Lua 5.3 Reference Manual"
[5]: https://luau.org/compatibility "Luau compatibility with Lua"
[6]: https://luau.org/syntax "Luau syntax by example"
[7]: https://luau.org/performance "How Luau makes Luau fast"
