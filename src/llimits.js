"use strict";

const lua_assert = function(c) {
    if (!c) throw Error("assertion failed");
};
module.exports.lua_assert = lua_assert;

const api_check = function(l, e, msg) {
    if (!e) throw Error(msg);
};
module.exports.api_check = api_check;

const LUAI_MAXCCALLS = 200;
module.exports.LUAI_MAXCCALLS = LUAI_MAXCCALLS;

/* minimum size for string buffer */
const LUA_MINBUFFER = 32;
module.exports.LUA_MINBUFFER = LUA_MINBUFFER;

const luai_nummod = function(L, a, b) {
    let m = a % b;
    if ((m*b) < 0)
        m += b;
    return m;
};
module.exports.luai_nummod = luai_nummod;

/*
** MAX_INT / MIN_INT are used by the VM for overflow checks and for the
** generic-`for` loop limit clamping (see lvm.forlimit). They must mirror
** the public 64-bit limits exposed by luaconf.js (LUA_MAXINTEGER /
** LUA_MININTEGER) so that internal checks agree with math.maxinteger and
** math.mininteger.
**
** With the hybrid Number/BigInt integer representation these are the real
** int64 extremes (2^63-1 and -2^63), carried as BigInt because they fall
** outside the JS safe-integer range. Comparisons with hybrid int values
** work transparently because JS orders Number and BigInt sensibly.
*/
const { MAX_INT64, MIN_INT64, shrink } = require('./lint64.js');
const MAX_INT = shrink(MAX_INT64);  /*  9223372036854775807n */
module.exports.MAX_INT = MAX_INT;
const MIN_INT = shrink(MIN_INT64);  /* -9223372036854775808n */
module.exports.MIN_INT = MIN_INT;
