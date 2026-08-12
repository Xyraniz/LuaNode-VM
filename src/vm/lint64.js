"use strict";

/*
** lint64.js — True 64-bit signed integer arithmetic for LuaNode-VM.
**
** Lua 5.3 defines `lua_Integer` as a signed integer type with *at least*
** 64 bits. PUC-Rio Lua uses an int64_t, so:
**
**     LUA_MAXINTEGER ==  9223372036854775807   (2^63 - 1)
**     LUA_MININTEGER == -9223372036854775808   (-2^63)
**
** and arithmetic wraps around modulo 2^64 (two's-complement), e.g.
**
**     LUA_MAXINTEGER + 1 == LUA_MININTEGER
**     LUA_MININTEGER - 1 == LUA_MAXINTEGER
**
** JavaScript's `Number` type is an IEEE-754 double: it can only represent
** *every* integer in the range [-2^53+1, 2^53-1]. Beyond that, precision
** is lost (e.g. 9007199254740993 rounds to 9007199254740992), which is
** exactly the bug the previous "64-bit" claim of LuaNode-VM suffered from.
**
** To deliver *real* 64-bit integers we use a **hybrid representation**:
**
**   * Values inside the safe-integer range are stored as a JS `Number`
**     (zero-overhead fast path — identical to the original Fengari path
**      for the common case).
**
**   * Values outside the safe range — up to the full int64 span — are
**     stored as a JS `BigInt`, which has arbitrary precision and therefore
**     represents every int64 exactly.
**
** All arithmetic, bitwise and shift operations funnel through the helpers
** in this file, which perform overflow wraparound modulo 2^64 and return
** the smallest representation that still fits (Number when possible,
** BigInt otherwise). This guarantees:
**
**   * math.maxinteger and math.mininteger are the real int64 extremes.
**   * integer overflow wraps around (Lua 5.3 semantics).
**   * every integer literal up to 9223372036854775807 parses exactly.
**   * table keys that are large integers never collide.
**   * bytecode (de)serialization round-trips every int64 losslessly.
**
** The module is self-contained (no other LuaNode-VM file is required) so
** it can be required from the lexer, the VM, the object layer, the math
** library, the string library and the bytecode dump/load code without
** creating import cycles.
*/

/* The real int64 limits, as BigInt for exactness. */
const MAX_INT64   = 9223372036854775807n;   /*  2^63 - 1 */
const MIN_INT64   = -9223372036854775808n;  /* -2^63      */
const MODULO      = 0x10000000000000000n;   /*  2^64      */

/* JS Number safe-integer bounds. Values within these are kept as Number. */
const MAX_SAFE    = Number.MAX_SAFE_INTEGER;   /*  2^53 - 1 */
const MIN_SAFE    = Number.MIN_SAFE_INTEGER;   /* -2^53 + 1 */

/*
** Does a JS value currently hold an integer in our hybrid representation?
** We accept both plain Numbers that are integral and BigInts.
*/
const isIntRep = function(v) {
    if (typeof v === "bigint") return true;
    return typeof v === "number" && Number.isInteger(v);
};

/*
** Is `v` an integer that fits comfortably in the Number fast path?
** (i.e. inside the safe-integer range.)
*/
const isSafeNumber = function(v) {
    return typeof v === "number" && Number.isInteger(v) &&
           v >= MIN_SAFE && v <= MAX_SAFE;
};

/*
** Convert any of {Number, BigInt} holding an integer into a BigInt.
*/
const toBigInt = function(v) {
    return typeof v === "bigint" ? v : BigInt(v);
};

/*
** Convert a BigInt back to a JS Number when it fits the safe range,
** otherwise leave it as a BigInt. This is the canonical "shrink" step
** applied after every operation so we always store the smallest
** representation that still preserves the exact value.
*/
const shrink = function(b) {
    if (b >= MIN_SAFE && b <= MAX_SAFE)
        return Number(b);
    return b;
};

/*
** Normalise an arbitrary integer-like value into our hybrid form:
** Number when it fits the safe range, BigInt otherwise. Non-integers,
** NaN and Infinity are rejected (return null).
*/
const normalize = function(v) {
    if (typeof v === "bigint") {
        /* Reject out-of-range BigInts (should never happen for lua_Integer). */
        if (v < MIN_INT64 || v > MAX_INT64) return null;
        return shrink(v);
    }
    if (typeof v === "number") {
        if (!Number.isInteger(v)) return null;
        if (v >= MIN_SAFE && v <= MAX_SAFE) return v;
        /* A Number outside the safe range but still integral: promote to
           BigInt via the exact decimal string to avoid double rounding. */
        return shrink(BigInt(v.toFixed(0)));
    }
    return null;
};

/*
** Apply two's-complement wraparound modulo 2^64 to a (possibly
** out-of-range) BigInt, then shrink back to Number if it fits.
*/
const wrap = function(b) {
    let r = b % MODULO;
    if (r < MIN_INT64) r += MODULO;       /* bring into signed range */
    else if (r > MAX_INT64) r -= MODULO;
    return shrink(r);
};

/* ---- arithmetic with wraparound ------------------------------------- */

const add = function(a, b) {
    if (isSafeNumber(a) && isSafeNumber(b)) {
        /* Fast path: only promote when the result can exceed the safe range. */
        let r = a + b;
        if (r >= MIN_SAFE && r <= MAX_SAFE) return r;
    }
    return wrap(toBigInt(a) + toBigInt(b));
};

const sub = function(a, b) {
    if (isSafeNumber(a) && isSafeNumber(b)) {
        let r = a - b;
        if (r >= MIN_SAFE && r <= MAX_SAFE) return r;
    }
    return wrap(toBigInt(a) - toBigInt(b));
};

const mul = function(a, b) {
    if (isSafeNumber(a) && isSafeNumber(b)) {
        /* Cheap overflow heuristic: if both magnitudes are small enough the
           product cannot leave the safe range, stay on the fast path. */
        let aa = a < 0 ? -a : a;
        let bb = b < 0 ? -b : b;
        if (aa <= 0x200000 && bb <= 0x200000) {  /* ~2^21 * 2^21 < 2^42 << 2^53 */
            return a * b;
        }
        let r = a * b;
        if (Number.isInteger(r) && r >= MIN_SAFE && r <= MAX_SAFE) return r;
    }
    return wrap(toBigInt(a) * toBigInt(b));
};

const neg = function(a) {
    if (isSafeNumber(a)) {
        let r = -a;
        if (r >= MIN_SAFE && r <= MAX_SAFE) return r;
    }
    return wrap(-toBigInt(a));
};

/*
** Integer division (Lua `//`) and modulo (Lua `%`) with Lua 5.3 semantics:
** the quotient is floor(a / b) and  a == (a // b) * b + (a % b), with the
** remainder taking the sign of the divisor. Division/modulo by zero is an
** error raised by the caller (the VM), not here, so this helper returns a
** raw BigInt quotient that the caller wraps.
**
** The MIN_INT64 // -1 corner case is handled explicitly: PUC-Rio Lua
** returns MIN_INT64, avoiding the unrepresentable positive quotient.
*/
const idiv = function(a, b) {
    let ba = toBigInt(a), bb = toBigInt(b);
    if (bb === 0n) return "divzero";
    if (ba === MIN_INT64 && bb === -1n) return MIN_INT64;
    /* BigInt division truncates toward zero; Lua wants floor. */
    let q = ba / bb;
    if ((ba < 0n) !== (bb < 0n) && q * bb !== ba) q -= 1n;
    return wrap(q);
};

const imod = function(a, b) {
    let ba = toBigInt(a), bb = toBigInt(b);
    if (bb === 0n) return "divzero";
    /* MIN % -1 == 0 in Lua (no overflow). */
    if (ba === MIN_INT64 && bb === -1n) return 0;
    let r = ba % bb;
    if (r !== 0n && (r < 0n) !== (bb < 0n)) r += bb;  /* floor semantics */
    return shrink(r);
};

/* ---- bitwise & shift (64-bit, two's complement) --------------------- */
/*
** BigInt natively supports arbitrary-precision bitwise ops on *negative*
** numbers using two's-complement semantics of infinite width, which does
** NOT match fixed 64-bit semantics. We therefore mask every operand to
** 64 bits (as an unsigned value), perform the op, then re-interpret the
** result as a signed int64 and shrink it.
*/
const MASK64 = MODULO - 1n;   /* 2^64 - 1 */

const toU64 = function(v) { return BigInt.asUintN(64, toBigInt(v)); };

const band = function(a, b) { return wrap(BigInt.asIntN(64, toU64(a) & toU64(b))); };
const bor  = function(a, b) { return wrap(BigInt.asIntN(64, toU64(a) | toU64(b))); };
const bxor = function(a, b) { return wrap(BigInt.asIntN(64, toU64(a) ^ toU64(b))); };
const bnot = function(a)    { return wrap(BigInt.asIntN(64, ~toU64(a))); };

/*
** Shifts: Lua 5.3 defines shifts on the 64-bit unsigned interpretation
** of the value. Negative shift counts shift in the opposite direction.
** Shifts by >= 64 yield 0. The result is re-interpreted as signed int64.
*/
const shiftl = function(x, y) {
    let sy = toBigInt(y);
    if (sy < 0n) return shiftr(x, -sy);
    if (sy >= 64n) return 0;
    return wrap(BigInt.asIntN(64, toU64(x) << sy));
};

const shiftr = function(x, y) {
    let sy = toBigInt(y);
    if (sy < 0n) return shiftl(x, -sy);
    if (sy >= 64n) return 0;
    /* logical (unsigned) right shift */
    return wrap(BigInt.asIntN(64, toU64(x) >> sy));
};

/*
** math.ult(a, b): unsigned 64-bit comparison — is a < b when both are
** interpreted as unsigned 64-bit values?
*/
const ult = function(a, b) {
    return toU64(a) < toU64(b);
};

/* ---- comparisons ---------------------------------------------------- */
/*
** All integer values, whether Number or BigInt, compare correctly with
** the native <, <=, === operators because JS coerces BigInt and Number
** sensibly for comparison (they are never equal across types, but
** ordering works). We provide explicit helpers for clarity and to make
** sure we never accidentally mix a BigInt with a Number using arithmetic.
*/
const eq = function(a, b) {
    if (typeof a === "bigint" || typeof b === "bigint")
        return toBigInt(a) === toBigInt(b);
    return a === b;
};

const lt = function(a, b) {
    if (typeof a === "bigint" || typeof b === "bigint")
        return toBigInt(a) < toBigInt(b);
    return a < b;
};

const le = function(a, b) {
    if (typeof a === "bigint" || typeof b === "bigint")
        return toBigInt(a) <= toBigInt(b);
    return a <= b;
};

/* ---- conversions ---------------------------------------------------- */

/*
** Convert a JS float (Number) to a lua_Integer using Lua 5.3 rounding
** mode:  mode 0 = only if integral, 1 = floor, 2 = ceil.
** Returns the hybrid int value, or null if it does not fit / is not
** integral and mode == 0.
*/
const fromFloat = function(n, mode) {
    if (typeof n !== "number" || !isFinite(n)) return null;
    let f = Math.floor(n);
    if (n !== f) {
        if (mode === 0) return null;
        if (mode > 1) f += 1;       /* ceil */
    }
    if (f >= MIN_SAFE && f <= MAX_SAFE) return f;
    if (f < -9.223372036854776e18 || f > 9.2233720368547755e18) return null;
    /* Outside safe range but within int64: go via BigInt for exactness. */
    let b = BigInt(f.toFixed(0));
    if (b < MIN_INT64 || b > MAX_INT64) return null;
    return shrink(b);
};

/*
** Convert a hybrid int value to a JS Number (float). Used when an integer
** must be promoted to float (e.g. integer // float, or float arithmetic
** involving an int). BigInts outside the safe range lose precision here
** — that is correct Lua behaviour (a float cannot hold every int64).
*/
const toFloat = function(v) {
    return typeof v === "bigint" ? Number(v) : v;
};

/*
** Convert a hybrid int value to a decimal string. Used by lua_integer2str
** and string.format("%d"). BigInt.string gives the exact decimal form.
*/
const toDecimalString = function(v) {
    return typeof v === "bigint" ? v.toString() : String(v);
};

/*
** Convert a decimal string to a hybrid int, or null on overflow / invalid.
** Accepts an optional leading sign. Used by the lexer / str2int.
*/
const fromDecimalString = function(s) {
    try {
        let b = BigInt(s);
        if (b < MIN_INT64 || b > MAX_INT64) return null;
        return shrink(b);
    } catch (e) {
        return null;
    }
};

/*
** Convert a hex string (no leading "0x", optional sign) to a hybrid int
** or null on overflow / invalid. Used by the lexer for 0x... literals.
*/
const fromHexString = function(s, neg) {
    try {
        let b = BigInt("0x" + s);
        if (neg) b = -b;
        if (b < MIN_INT64 || b > MAX_INT64) return null;
        return shrink(b);
    } catch (e) {
        return null;
    }
};

/* ---- (de)serialization helpers -------------------------------------- */
/*
** Serialize a hybrid int as 8 little-endian bytes (two's complement int64).
** Used by ldump.js. Works for the full int64 range because we go via BigInt.
*/
const toBytesLE = function(v) {
    let u = toU64(v);          /* unsigned 64-bit view */
    let ab = new ArrayBuffer(8);
    let dv = new DataView(ab);
    dv.setUint32(0, Number(u & 0xFFFFFFFFn), true);
    dv.setUint32(4, Number(u >> 32n), true);
    return new Uint8Array(ab);
};

/*
** Reconstruct a hybrid int from 8 little-endian bytes (two's complement
** int64). Used by lundump.js.
*/
const fromBytesLE = function(bytes) {
    let dv = new DataView(bytes.buffer, bytes.byteOffset, 8);
    let lo = BigInt(dv.getUint32(0, true));
    let hi = BigInt(dv.getUint32(4, true));
    let u = (hi << 32n) | lo;
    return wrap(BigInt.asIntN(64, u));
};

module.exports = {
    MAX_INT64,
    MIN_INT64,
    MODULO,
    MAX_SAFE,
    MIN_SAFE,
    isIntRep,
    isSafeNumber,
    toBigInt,
    toFloat,
    toDecimalString,
    toBytesLE,
    fromBytesLE,
    normalize,
    shrink,
    wrap,
    /* arithmetic */
    add, sub, mul, neg, idiv, imod,
    /* bitwise / shift */
    band, bor, bxor, bnot, shiftl, shiftr, ult,
    /* comparison */
    eq, lt, le,
    /* conversions */
    fromFloat, fromDecimalString, fromHexString
};
