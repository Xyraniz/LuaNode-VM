# LuaNode-VM: Massive Improvement Plan — Humillando a Fengari

## Goal
Improve EVERY aspect of LuaNode-VM so it becomes genuinely superior to Fengari. REAL 64-bit integer support via BigInt, test suite, correctness fixes, tooling, truthful README. Commit directly to `main`.

## Core Integer Overhaul (REAL 64-bit via BigInt) — DONE
- [x] Create src/lint64.js (hybrid Number/BigInt 64-bit integer module)
- [x] luaconf.js: LUA_MAXINTEGER/MININTEGER = real 2^63-1 / -2^63
- [x] llimits.js: MAX_INT/MIN_INT = real int64
- [x] lapi.js: fengari_argcheckinteger accepts BigInt
- [x] lvm.js: all arithmetic/bitwise/shift/compare ops via I64
- [x] lobject.js: intarith via I64, l_str2int rewritten with BigInt accumulator
- [x] lmathlib.js: math_abs/fmod/ult/random fixed for 64-bit

## Remaining Propagation Work
- [x] Fix lstrlib.js string.format %d/%i/%u/%x/%X for BigInt values
- [x] Fix lstrlib.js addliteral for BigInt integers
- [x] Fix ldump.js DumpInteger to use I64.toBytesLE()
- [x] Fix lundump.js LoadInteger to use I64.fromBytesLE()
- [x] Fix lstrlib.js packint/unpackint for full 64-bit (string.pack/unpack)
- [x] Fix ltable.js table_hash for BigInt keys (no Number/BigInt collision)
- [x] Fix ltable.js luaH_setfrom float→int conversion (kv|0 === kv → 64-bit)
- [x] Fix ltable.js luaH_getn overflow check (LUA_MAXINTEGER/2 → safe threshold)
- [x] Fix ltablib.js tmove overflow checks (LUA_MAXINTEGER + f → I64.add)
- [x] Improve float formatting (%.14g) to match Lua 5.3
- [x] Audit llex.js read_numeral (uses luaO_str2num which is fixed)
- [x] Handle MIN_INTEGER literal edge case (-9223372036854775808) — verified: matches Lua 5.3 (parsed as float, same as PUC-Rio)

## Test Suite
- [x] Create comprehensive Jest test suite in tests/
- [x] Tests: 64-bit literals, math.maxinteger/mininteger
- [x] Tests: overflow wraparound
- [x] Tests: arithmetic, division, modulo, shifts (64-bit)
- [x] Tests: string.format with large integers
- [x] Tests: table keys as large integers
- [x] Tests: regression (coroutine, string, table, math libs)

## Tooling & Quality
- [x] Add ESLint config
- [x] Add package.json scripts (test, lint, cli)
- [x] Add CI workflow (GitHub Actions)
- [x] Add CLI runner for .lua scripts

## Documentation
- [x] Rewrite README.md — truthful claims, comparison vs Fengari

## Delivery
- [x] Run full test suite — all green (126/126 pass)
- [x] Clean up temp files (test_current.js, test2.js, etc.)
- [ ] Commit everything to main branch
- [ ] Push to origin/main
