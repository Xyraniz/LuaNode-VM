<p align="center">
<img src="logo.png" alt="LuaNode VM Logo" width="160" />
</p>

# LuaNode-VM

> **A Lua 5.3 Virtual Machine implemented in modern JavaScript, featuring true 64-bit integer arithmetic via BigInt — extending Fengari's 32-bit integers to the full int64 range of PUC-Rio Lua.**

## Overview

LuaNode-VM is a JavaScript implementation of the Lua 5.3 virtual machine, originally derived from [Fengari](https://github.com/fengari-lua/fengari) and substantially overhauled to address Fengari's integer width. **Fengari represents Lua's `lua_Integer` as a signed 32-bit integer: its `luaconf.js` defines `LUA_MAXINTEGER = 2147483647` and `LUA_MININTEGER = -2147483648` (2^31−1 / −2^31), with correct two's-complement wraparound at that width.** This is a deliberate, documented design decision in Fengari (equivalent to building PUC-Rio Lua with `LUA_INT_TYPE=LUA_INT_LONG` on a platform where `long` is 32 bits) — not a bug — but it diverges from PUC-Rio Lua 5.3, whose `lua_Integer` is a full 64-bit `int64_t` (`LUA_MAXINTEGER = 9223372036854775807`).

LuaNode-VM closes that gap with a **hybrid Number/BigInt representation**: values within the JS safe-integer range (±2^53−1) use plain `Number` for speed, while values outside that range — up to the full signed 64-bit span — use `BigInt`. All arithmetic, bitwise, comparison, parsing, formatting, bytecode serialization, and table operations have been rewritten to respect true int64 semantics with two's-complement wraparound modulo 2^64, exactly matching PUC-Rio Lua 5.3.

> **Note on a previous version of this README:** An earlier revision claimed that Fengari used JavaScript `Number` (IEEE-754 double) for `lua_Integer` and therefore reported `math.maxinteger = 9007199254740991` (2^53−1). **That claim was inaccurate.** Fengari uses 32-bit integers (`2147483647`), not double-precision floats truncated to 53 bits. The comparison has been corrected below to reflect what Fengari's source code actually does. The genuine advantage of LuaNode-VM is widening the integer type from 32 bits to a full 64 bits — not "fixing a 53-bit truncation."

### The Real Difference: Fengari's 32-bit Integers vs. LuaNode-VM's 64-bit Integers

| Issue | Fengari (original) | LuaNode-VM |
|-------|-------------------|------------|
| `math.maxinteger` | `2147483647` (2^31−1, by design) | `9223372036854775807` (2^63−1) ✓ |
| `math.mininteger` | `-2147483648` (−2^31, by design) | `-9223372036854775808` (−2^63) ✓ |
| `math.maxinteger + 1` | wraps to `-2147483648` (correct 32-bit wraparound) | wraps to `-9223372036854775808` (correct 64-bit wraparound) ✓ |
| Literal `9223372036854775807` | out of 32-bit range → parsed as float (precision loss beyond 2^53) | exact 64-bit integer ✓ |
| Literal `9007199254740993` | out of 32-bit range → parsed as float, rounded to `...992` | exact integer: `9007199254740993` ✓ |
| Integer overflow width | 32-bit two's-complement | 64-bit two's-complement mod 2^64 ✓ |
| `string.format("%d", big_int)` | fails/truncates above 2^31−1 | full 64-bit precision ✓ |
| `string.pack`/`unpack` with `i8` | fails for values above 2^31−1 ("number has no integer representation") | full 64-bit ✓ |
| Bytecode dump/load of large ints | precision loss / float fallback | exact 8-byte LE round-trip ✓ |
| Table keys above 2^31 | coerced to float (collisions above 2^53) | distinct keys via BigInt ✓ |

---

## Key Features

- **True 64-bit `lua_Integer` via BigInt**: Hybrid Number/BigInt representation with automatic shrinking back to `Number` when values re-enter the safe range. Full int64 range [-2^63, 2^63-1] with correct two's-complement overflow wraparound.

- **Complete arithmetic semantics**: Integer addition, subtraction, multiplication, negation, floor division (`//`), and modulo all respect 64-bit wraparound. The `MIN_INT64 / -1` overflow case correctly raises an error, matching PUC-Rio Lua.

- **64-bit bitwise operations**: `&`, `|`, `~` (xor), `~` (bnot), `<<`, `>>`, and `~>` (unsigned right shift) all operate on the full 64-bit width using `BigInt.asUintN(64, ...)` and `BigInt.asIntN(64, ...)` masking.

- **Accurate string formatting**: `string.format` with `%d`, `%i`, `%u`, `%o`, `%x`, `%X` handles BigInt values with correct flags (`-+ 0#`), width, and precision. The `%q` literal formatter prints `math.mininteger` in hex form (`0x8000000000000000`), matching PUC-Rio Lua exactly. Float formatting uses `%.14g` with proper scientific notation, and `%e`/`%E` exponents use minimum two digits.

- **Full bytecode serialization**: `string.dump`/`load` round-trips preserve full 64-bit integer constants via 8-byte little-endian encoding, verified with values like `9007199254740993` that would lose precision under the old approach.

- **`string.pack`/`string.unpack` with 64-bit integers**: The `i8`/`I8`/`j`/`J` format options correctly pack and unpack full 64-bit integers using BigInt byte extraction, no 32-bit truncation.

- **Table keys without collision**: Large integer table keys (above 2^53) are correctly stored and retrieved without Number/BigInt hash collisions, and `table.move` overflow checks use full 64-bit arithmetic.

- **Cross-environment execution**: Runs natively in both Node.js and modern web browsers with identical API and semantics.

- **Familiar C-API-compatible JavaScript API**: Preserves the intuitive JavaScript API mirroring the Lua C API (`lua_State`, stack manipulation, library loading) established by Fengari.

- **CLI runner**: Execute `.lua` scripts directly from the command line with `node cli/luanode.js script.lua args...`.

- **Comprehensive test suite**: 145+ Jest tests covering 64-bit integers, string formatting, table operations, coroutines, closures, metatables, lexer buffer-growth regression (string literals up to 10000 chars), `collectgarbage`, and general Lua 5.3 regression.

---

## Installation

```bash
git clone https://github.com/Xyraniz/LuaNode-VM.git
cd LuaNode-VM
npm install
```

---

## Quick Start

### Running Lua Scripts from the Command Line

```bash
# Run a Lua script file
node cli/luanode.js myscript.lua arg1 arg2

# Execute a Lua expression
node cli/luanode.js -e "print(math.maxinteger); print(math.maxinteger + 1)"

# Show version
node cli/luanode.js -v
```

### JavaScript API

```javascript
const F = require('./src/fengari.js');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = F;

// Create a Lua state and open standard libraries
const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

// Load and run a Lua string
const code = `
    print("math.maxinteger =", math.maxinteger)
    print("math.mininteger =", math.mininteger)
    print("overflow:", math.maxinteger + 1)
    print("bitwise:", 0xFFFFFFFFFFFFFFFF & 0x0)
`;

if (lauxlib.luaL_loadstring(L, to_luastring(code)) === lua.LUA_OK) {
    lua.lua_pcall(L, 0, 0, 0);
}
```

### 64-bit Integer Demonstration

```lua
-- math.maxinteger is the REAL 2^63-1 (Fengari reports 2^31-1 = 2147483647)
print(math.maxinteger)        --> 9223372036854775807
print(math.mininteger)        --> -9223372036854775808

-- Overflow wraps around (two's complement modulo 2^64)
print(math.maxinteger + 1)    --> -9223372036854775808
print(math.mininteger - 1)    --> 9223372036854775807

-- Full 64-bit arithmetic
print(9223372036854775807 * 2)  --> -2

-- Large literals preserve precision
print(9007199254740993)       --> 9007199254740993  (not rounded!)

-- Integer floor division and modulo
print(7 // 2)                 --> 3
print(-7 // 2)               --> -4
print(7 % 3)                 --> 1
print(-7 % 3)               --> 2

-- Bitwise on full 64-bit width
print(0x7FFFFFFFFFFFFFFF & 0xFFFFFFFFFFFFFFFF)  --> 9223372036854775807

-- string.format handles full 64-bit integers
print(string.format("%d", 9223372036854775807))  --> 9223372036854775807
print(string.format("%x", 0xFFFFFFFFFFFFFFFF))   --> ffffffffffffffff

-- Table keys above 2^53 work correctly
local t = {}
t[9007199254740993] = "hello"
print(t[9007199254740993])    --> hello
```

---

## Testing

LuaNode-VM includes a comprehensive Jest test suite (145+ tests) verifying:

- **64-bit integer limits and literals** (`tests/int64.test.js`)
- **Overflow wraparound semantics** (`tests/int64.test.js`)
- **Arithmetic, division, modulo, and bitwise operations** (`tests/int64.test.js`)
- **String formatting with large integers** (`tests/string-format.test.js`)
- **Table operations with large integer keys** (`tests/table-keys.test.js`)
- **Regression tests for general Lua 5.3 functionality** (`tests/regression.test.js`)
- **Lexer token-buffer growth regression** (`tests/lexer-buffer.test.js`) — string literals, identifiers, comments, and error messages of 31–10000 characters, plus `collectgarbage`

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run a specific test file
npx jest tests/int64.test.js
```

### Linting

```bash
npm run lint
```

---

## How 64-bit Integer Support Works

The core of LuaNode-VM's integer overhaul is `src/vm/lint64.js`, a self-contained module providing hybrid Number/BigInt 64-bit integer arithmetic. The design principles are:

1. **Fast path for safe integers**: Values within `Number.MIN_SAFE_INTEGER` to `Number.MAX_SAFE_INTEGER` (±2^53-1) are stored as plain JavaScript `Number`. This covers the vast majority of real-world integer usage and avoids BigInt overhead.

2. **BigInt for the full int64 range**: Values outside the safe range — up to the full signed 64-bit span [-2^63, 2^63-1] — are stored as `BigInt`. The `shrink()` function converts BigInt back to Number when a value re-enters the safe range.

3. **Two's-complement wraparound**: The `wrap()` function applies `BigInt.asIntN(64, ...)` to produce correct signed 64-bit overflow semantics. For example, `9223372036854775807 + 1` wraps to `-9223372036854775808`, exactly as in PUC-Rio Lua.

4. **Bitwise operations on 64-bit width**: All bitwise ops use `BigInt.asUintN(64, ...)` for unsigned interpretation and `BigInt.asIntN(64, ...)` for signed results, ensuring correct behavior across the full int64 range.

5. **Pervasive propagation**: The I64 module is used throughout the VM — in `lvm.js` (all opcodes), `lobject.js` (constant folding, string-to-integer parsing), `lstrlib.js` (string.format, string.pack/unpack), `ldump.js`/`lundump.js` (bytecode serialization), `ltable.js` (table key hashing), `ltablib.js` (table.move), `lmathlib.js` (math library), `lapi.js` (API functions), and `luaconf.js`/`llimits.js` (configuration constants).

---

## Architectural Origin & Transparency

LuaNode-VM is explicitly a **specialized fork of Fengari** (`fengari-lua/fengari`). We believe in radical transparency:

- The core virtual machine architecture, lexical parser, and module organization originate from the excellent work of the Fengari team.

- LuaNode-VM's independent development focuses on: (1) true 64-bit integer support via BigInt, (2) comprehensive correctness testing, (3) modern tooling (ESLint, CI, CLI), and (4) a truthful, accurate README.

- We acknowledge that prior versions of this README made inaccurate claims about "64-bit integer support" that were, in reality, limited to JavaScript's 53-bit safe-integer range, and — separately — incorrectly characterized Fengari as using double-precision floats truncated to 53 bits. Both have been corrected: Fengari uses 32-bit integers (`2147483647`), and LuaNode-VM delivers genuine 64-bit integers. The claims in this README are verified by the test suite and can be independently confirmed by inspecting [Fengari's `src/luaconf.js`](https://github.com/fengari-lua/fengari/blob/master/src/luaconf.js) and running the code here.

- We also acknowledge and have fixed a critical lexer bug present in early revisions: because `MAX_INT` was changed from a JS `Number` to a `BigInt`, the lexer's token-buffer growth check (`b.buffer.length >= MAX_INT/2`) mixed a `Number` with a `BigInt` under arithmetic and threw `TypeError: Cannot mix BigInt and other types`. That line only executed the first time a token grew past `LUA_MINBUFFER` (32 bytes), so **any** string literal, identifier, comment, or error message of ~31+ characters silently killed the interpreter (exit status `-1`, "no error message"). This is now fixed (see `src/vm/llex.js`) and covered by regression tests in `tests/lexer-buffer.test.js`, which verify string literals up to 10000 characters parse and execute correctly.

---

## Continuous Integration

GitHub Actions CI runs on every push and pull request to `main`, testing across Node.js 18, 20, and 22:

- ESLint (zero errors required)
- Full Jest test suite (all tests must pass)
- 64-bit integer verification against reference Lua 5.3

See `.github/workflows/ci.yml` for details.

---

## Project Structure

```
LuaNode-VM/
├── src/
│   ├── defs.js                # String conversion helpers (luastring type)
│   ├── fengari.js             # Main entry point / public API
│   ├── fengaricore.js         # Fengari core (version info, string helpers)
│   ├── fengarilib.js          # Fengari library bridge
│   ├── lua.js                 # Public Lua API surface
│   ├── luaconf.js             # Configuration (true int64 limits, %.14g format)
│   ├── lauxlib.js             # Auxiliary library
│   ├── linit.js               # Library initialization
│   ├── vm/                    # Virtual machine core (internal engine)
│   │   ├── lint64.js          # Core 64-bit integer module (hybrid Number/BigInt)
│   │   ├── lvm.js             # Virtual machine (opcodes use I64)
│   │   ├── lobject.js         # Object model (intarith, l_str2int via BigInt)
│   │   ├── lapi.js            # C API (accepts BigInt integers)
│   │   ├── ltable.js          # Tables (BigInt key hashing, 64-bit conversions)
│   │   ├── llex.js            # Lexer
│   │   ├── lcode.js           # Code generator
│   │   ├── lparser.js         # Parser
│   │   ├── lopcodes.js        # Instruction opcodes
│   │   ├── ldebug.js          # Debug interface
│   │   ├── ldo.js             # Call stack / coroutine handling
│   │   ├── lfunc.js           # Function objects
│   │   ├── lstate.js          # Lua state / global state
│   │   ├── lstring.js         # String table / interning
│   │   ├── ltm.js             # Tag methods (metamethods)
│   │   ├── lzio.js            # Buffered I/O abstraction
│   │   ├── llimits.js         # Limits (MAX_INT/MIN_INT = real int64)
│   │   ├── ljstype.js         # Type metadata tables
│   │   ├── ldump.js           # Bytecode serializer (8-byte LE integers)
│   │   └── lundump.js         # Bytecode deserializer (8-byte LE integers)
│   └── stdlib/
│       ├── lstrlib.js         # String library (formatInteger, pack/unpack 64-bit)
│       ├── lmathlib.js        # Math library (abs, fmod, ult, random for 64-bit)
│       ├── ltablib.js         # Table library (table.move with 64-bit checks)
│       └── ...
├── tests/
│   ├── lua-helpers.js         # Test utility module
│   ├── int64.test.js          # 64-bit integer tests
│   ├── string-format.test.js  # string.format tests
│   ├── table-keys.test.js     # Table key tests
│   └── regression.test.js     # General Lua 5.3 regression tests
├── cli/
│   └── luanode.js             # CLI runner for .lua scripts
├── .github/workflows/ci.yml   # CI configuration
├── eslint.config.js           # ESLint flat config
└── package.json
```

---

## License

This project is open-source software licensed under the **MIT License**. See the [LICENSE](LICENSE) file for complete details.

The original Fengari project is also MIT-licensed. We gratefully acknowledge the Fengari team for the foundational work upon which LuaNode-VM builds.
