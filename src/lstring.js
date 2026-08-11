"use strict";

const {
    is_luastring,
    luastring_eq,
    luastring_from,
    to_luastring
} = require('./defs.js');
const { lua_assert } = require("./llimits.js");

/**
 * TString is the runtime representation of a Lua string.
 *
 * It wraps a Uint8Array of bytes (the actual string contents) and caches
 * the computed hash so that repeated table lookups for the same key do
 * not re-hash the contents every time.
 */
class TString {

    constructor(L, str) {
        /** Cached hash key (computed lazily by luaS_hashlongstr). */
        this.hash = null;
        /** Raw byte contents of the string. */
        this.realstring = str;
    }

    /** Returns the underlying byte array. */
    getstr() {
        return this.realstring;
    }

    /** Returns the length in bytes. */
    tsslen() {
        return this.realstring.length;
    }

}

/**
 * Reports whether two TString values are equal.
 * Identity is checked first (common case for interned strings); otherwise
 * the byte contents are compared.
 */
const luaS_eqlngstr = (a, b) => {
    lua_assert(a instanceof TString);
    lua_assert(b instanceof TString);
    return a === b || luastring_eq(a.realstring, b.realstring);
};

/*
** luaS_hash converts a Lua string (Uint8Array of bytes) into a
** consistent Map key.
**
** The result must not collide with keys produced by ltable.table_hash
** for other types. Integers/floats/booleans use their raw JS value as a
** key, so strings are prefixed with "|" to stay in a separate namespace.
**
** PERFORMANCE: the original implementation built the key by repeatedly
** concatenating one hex character at a time:
**     s = "|"; for (...) s += str[i].toString(16);
** That is O(n^2) because every "+=" allocates a brand-new string, and
** luaS_hash is on the hot path for every table lookup with a string key.
**
** The new implementation converts the whole byte array to a JS string in
** a single pass (treating each byte as a Latin-1 code unit, which is
** exactly how Fengari stores Lua strings) and prefixes it with "|".
** This is O(n) and avoids all intermediate allocations. We fall back to
** a chunked String.fromCharCode for very long strings so we never exceed
** the call-stack argument limit (~65k on most engines).
*/
const HASH_PREFIX = "|";
const FROMCHARCODE_CHUNK = 0x8000; /* 32k args per call — well under limits */

const luaS_hash = (str) => {
    lua_assert(is_luastring(str));
    const len = str.length;
    if (len <= FROMCHARCODE_CHUNK) {
        /* Fast path: single fromCharCode call covers the whole string. */
        return HASH_PREFIX + String.fromCharCode.apply(null, str);
    }
    /* Long-string path: build in chunks to avoid argument limits. */
    let s = HASH_PREFIX;
    for (let i = 0; i < len; i += FROMCHARCODE_CHUNK) {
        s += String.fromCharCode.apply(null, str.subarray(i, i + FROMCHARCODE_CHUNK));
    }
    return s;
};

/**
 * Returns the cached hash key for a (long) TString, computing it on first
 * use and memoizing the result on the TString itself so subsequent lookups
 * are O(1).
 */
const luaS_hashlongstr = function(ts) {
    lua_assert(ts instanceof TString);
    if (ts.hash === null) {
        ts.hash = luaS_hash(ts.getstr());
    }
    return ts.hash;
};

/*
** NOTE: luaS_bless / luaS_new / luaS_newliteral are declared as function
** expressions (not arrow functions) because existing call sites in ltm.js
** and elsewhere invoke them with `new` (e.g. `new luaS_new(L, ...)`).
** Arrow functions cannot be used with `new`; regular function expressions
** can, and because these functions return a non-primitive object the
** `new`-constructed result is the returned TString, preserving the
** original behaviour.
*/

/** Takes ownership of the given Uint8Array without copying. */
const luaS_bless = function(L, str) {
    lua_assert(str instanceof Uint8Array);
    return new TString(L, str);
};

/** Makes a copy of the input and wraps it in a TString. */
const luaS_new = function(L, str) {
    return luaS_bless(L, luastring_from(str));
};

/** Convenience wrapper that takes a JS string. */
const luaS_newliteral = function(L, str) {
    return luaS_bless(L, to_luastring(str));
};

module.exports.luaS_eqlngstr    = luaS_eqlngstr;
module.exports.luaS_hash        = luaS_hash;
module.exports.luaS_hashlongstr = luaS_hashlongstr;
module.exports.luaS_bless       = luaS_bless;
module.exports.luaS_new         = luaS_new;
module.exports.luaS_newliteral  = luaS_newliteral;
module.exports.TString          = TString;
