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
** MAX_INT / MIN_INT are used by the VM for overflow checks and loop
** limits. They now mirror the 64-bit-safe integer range exposed by
** luaconf.js (LUA_MAXINTEGER / LUA_MININTEGER) so that internal checks
** agree with the public math.maxinteger / math.mininteger values.
*/
const MAX_INT = Number.MAX_SAFE_INTEGER;  /*  9007199254740991 */
module.exports.MAX_INT = MAX_INT;
const MIN_INT = -Number.MAX_SAFE_INTEGER; /* -9007199254740991 */
module.exports.MIN_INT = MIN_INT;
