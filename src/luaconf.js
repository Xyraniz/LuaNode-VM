"use strict";

const conf = (typeof process !== "undefined" && process.env && process.env.FENGARICONF) ? JSON.parse(process.env.FENGARICONF) : {};

const {
    LUA_VERSION_MAJOR,
    LUA_VERSION_MINOR,
    to_luastring
} = require('./defs.js');

/*
** LUA_PATH_SEP is the character that separates templates in a path.
** LUA_PATH_MARK is the string that marks the substitution points in a
** template.
** LUA_EXEC_DIR in a Windows path is replaced by the executable's
** directory.
*/
const LUA_PATH_SEP  = ";";
module.exports.LUA_PATH_SEP = LUA_PATH_SEP;

const LUA_PATH_MARK = "?";
module.exports.LUA_PATH_MARK = LUA_PATH_MARK;

const LUA_EXEC_DIR  = "!";
module.exports.LUA_EXEC_DIR = LUA_EXEC_DIR;

/*
@@ LUA_PATH_DEFAULT is the default path that Lua uses to look for
** Lua libraries.
@@ LUA_JSPATH_DEFAULT is the default path that Lua uses to look for
** JS libraries.
** CHANGE them if your machine has a non-conventional directory
** hierarchy or if you want to install your libraries in
** non-conventional directories.
*/
const LUA_VDIR = LUA_VERSION_MAJOR + "." + LUA_VERSION_MINOR;
module.exports.LUA_VDIR = LUA_VDIR;

if (typeof process === "undefined") {
    const LUA_DIRSEP = "/";
    module.exports.LUA_DIRSEP = LUA_DIRSEP;

    const LUA_LDIR = "./lua/" + LUA_VDIR + "/";
    module.exports.LUA_LDIR = LUA_LDIR;

    const LUA_JSDIR = LUA_LDIR;
    module.exports.LUA_JSDIR = LUA_JSDIR;

    const LUA_PATH_DEFAULT = to_luastring(
        LUA_LDIR + "?.lua;" + LUA_LDIR + "?/init.lua;" +
        /* LUA_JSDIR excluded as it is equal to LUA_LDIR */
        "./?.lua;./?/init.lua"
    );
    module.exports.LUA_PATH_DEFAULT = LUA_PATH_DEFAULT;

    const LUA_JSPATH_DEFAULT = to_luastring(
        LUA_JSDIR + "?.js;" + LUA_JSDIR + "loadall.js;./?.js"
    );
    module.exports.LUA_JSPATH_DEFAULT = LUA_JSPATH_DEFAULT;
} else if (require('os').platform() === 'win32') {
    const LUA_DIRSEP = "\\";
    module.exports.LUA_DIRSEP = LUA_DIRSEP;

    /*
    ** In Windows, any exclamation mark ('!') in the path is replaced by the
    ** path of the directory of the executable file of the current process.
    */
    const LUA_LDIR = "!\\lua\\";
    module.exports.LUA_LDIR = LUA_LDIR;

    const LUA_JSDIR = "!\\";
    module.exports.LUA_JSDIR = LUA_JSDIR;

    const LUA_SHRDIR = "!\\..\\share\\lua\\" + LUA_VDIR + "\\";
    module.exports.LUA_SHRDIR = LUA_SHRDIR;

    const LUA_PATH_DEFAULT = to_luastring(
        LUA_LDIR + "?.lua;" + LUA_LDIR + "?\\init.lua;" +
        LUA_JSDIR + "?.lua;" + LUA_JSDIR + "?\\init.lua;" +
        LUA_SHRDIR + "?.lua;" + LUA_SHRDIR + "?\\init.lua;" +
        ".\\?.lua;.\\?\\init.lua"
    );
    module.exports.LUA_PATH_DEFAULT = LUA_PATH_DEFAULT;

    const LUA_JSPATH_DEFAULT = to_luastring(
        LUA_JSDIR + "?.js;" +
        LUA_JSDIR + "..\\share\\lua\\" + LUA_VDIR + "\\?.js;" +
        LUA_JSDIR + "loadall.js;.\\?.js"
    );
    module.exports.LUA_JSPATH_DEFAULT = LUA_JSPATH_DEFAULT;
} else {
    const LUA_DIRSEP = "/";
    module.exports.LUA_DIRSEP = LUA_DIRSEP;

    const LUA_ROOT = "/usr/local/";
    module.exports.LUA_ROOT = LUA_ROOT;
    const LUA_ROOT2 = "/usr/";

    const LUA_LDIR = LUA_ROOT + "share/lua/" + LUA_VDIR + "/";
    const LUA_LDIR2 = LUA_ROOT2 + "share/lua/" + LUA_VDIR + "/";
    module.exports.LUA_LDIR = LUA_LDIR;

    const LUA_JSDIR = LUA_LDIR;
    module.exports.LUA_JSDIR = LUA_JSDIR;
    const LUA_JSDIR2 = LUA_LDIR2;

    const LUA_PATH_DEFAULT = to_luastring(
        LUA_LDIR + "?.lua;" + LUA_LDIR + "?/init.lua;" +
        LUA_LDIR2 + "?.lua;" + LUA_LDIR2 + "?/init.lua;" +
        /* LUA_JSDIR(2) excluded as it is equal to LUA_LDIR(2) */
        "./?.lua;./?/init.lua"
    );
    module.exports.LUA_PATH_DEFAULT = LUA_PATH_DEFAULT;

    const LUA_JSPATH_DEFAULT = to_luastring(
        LUA_JSDIR + "?.js;" + LUA_JSDIR + "loadall.js;" +
        LUA_JSDIR2 + "?.js;" + LUA_JSDIR2 + "loadall.js;" +
        "./?.js"
    );
    module.exports.LUA_JSPATH_DEFAULT = LUA_JSPATH_DEFAULT;
}

/*
@@ LUA_COMPAT_FLOATSTRING makes Lua format integral floats without a
@@ a float mark ('.0').
** This macro is not on by default even in compatibility mode,
** because this is not really an incompatibility.
*/
const LUA_COMPAT_FLOATSTRING = conf.LUA_COMPAT_FLOATSTRING || false;

/*
** Lua 5.3 specifies that lua_Integer is a signed integer type with *at
** least* 64 bits. PUC-Rio Lua uses int64_t, so the canonical limits are:
**
**     LUA_MAXINTEGER ==  9223372036854775807   (2^63 - 1)
**     LUA_MININTEGER == -9223372036854775808   (-2^63)
**
** The original Fengari limited lua_Integer to 32 bits (it relied on
** DataView.setInt32/getInt32). An earlier revision of LuaNode-VM widened
** that to 53 bits (Number.MAX_SAFE_INTEGER) and *called* it "64-bit", but
** that was incorrect: 2^53-1 is not 2^63-1, integer overflow did not wrap
** around, and literals above 2^53 silently lost precision.
**
** LuaNode-VM now implements *true* 64-bit integers via a hybrid
** Number/BigInt representation (see src/lint64.js). Values inside the
** JavaScript safe-integer range [-2^53+1, 2^53-1] are stored as a plain
** Number (zero-overhead fast path, identical to Fengari for the common
** case); values outside that range — up to the full int64 span — are
** stored as a BigInt, which represents every int64 exactly. All
** arithmetic performs two's-complement wraparound modulo 2^64, matching
** PUC-Rio Lua semantics (e.g. math.maxinteger + 1 == math.mininteger).
**
** The public limits below are exposed to Lua as math.maxinteger /
** math.mininteger. They are the *real* int64 extremes. Because they lie
** outside the JS safe-integer range they are carried as BigInt values;
** lua_pushinteger / fengari_argcheckinteger have been updated to accept
** the hybrid representation so they can be pushed onto the stack verbatim.
*/
const { MAX_INT64, MIN_INT64, shrink } = require('./lint64.js');
const LUA_MAXINTEGER = shrink(MAX_INT64); /*  9223372036854775807n — BigInt, the real 2^63-1 */
const LUA_MININTEGER = shrink(MIN_INT64); /* -9223372036854775808n — BigInt, the real -2^63  */

/*
@@ LUAI_MAXSTACK limits the size of the Lua stack.
** CHANGE it if you need a different limit. This limit is arbitrary;
** its only purpose is to stop Lua from consuming unlimited stack
** space (and to reserve some numbers for pseudo-indices).
*/
const LUAI_MAXSTACK = conf.LUAI_MAXSTACK || 1000000;

/*
@@ LUA_IDSIZE gives the maximum size for the description of the source
@@ of a function in debug information.
** CHANGE it if you want a different size.
*/
const LUA_IDSIZE = conf.LUA_IDSIZE || (60-1); /* fengari uses 1 less than lua as we don't embed the null byte */

const { toDecimalString, fromFloat } = require('./lint64.js');

const lua_integer2str = function(n) {
    /* Hybrid int (Number or BigInt) -> exact decimal string.
       This matches the behaviour of LUA_INTEGER_FMT ("%d") in PUC-Rio Lua. */
    return toDecimalString(n);
};

const lua_number2str = function(n) {
    /* Emulate C's printf("%.14g", n) to match PUC-Rio Lua output exactly.
       %.14g uses at most 14 significant digits and switches to scientific
       notation when the exponent is < -4 or >= 14. */
    if (n === Infinity) return "inf";
    if (n === -Infinity) return "-inf";
    if (Number.isNaN(n)) return "nan";
    if (n === 0) return Object.is(n, -0) ? "-0" : "0";

    let neg = n < 0;
    let abs = Math.abs(n);
    let exp = Math.floor(Math.log10(abs));
    let precision = 14;

    /* %.14g: use scientific if exp < -4 or exp >= precision */
    if (exp < -4 || exp >= precision) {
        /* Scientific notation: d.dddddddddddddde[+-]dd (14 sig digits total) */
        let mantissa = abs / Math.pow(10, exp);
        let mantStr = mantissa.toPrecision(precision);
        mantStr = stripTrailingZeros(mantStr);
        let expStr;
        if (exp >= 0) expStr = (exp < 10) ? "+0" + exp : "+" + exp;
        else expStr = (exp > -10) ? "-0" + Math.abs(exp) : String(exp);
        return (neg ? "-" : "") + mantStr + "e" + expStr;
    } else {
        /* Fixed notation: use up to 14 significant digits */
        let str = abs.toPrecision(precision);
        str = stripTrailingZeros(str);
        return (neg ? "-" : "") + str;
    }
};

const stripTrailingZeros = function(s) {
    if (s.indexOf(".") >= 0) {
        s = s.replace(/0+$/, "").replace(/\.$/, "");
    }
    return s;
};

/*
** Convert a JS float to a lua_Integer using Lua 5.3 "numbertointeger"
** semantics: the float must have an integral value that fits in an int64.
** Returns the (hybrid) integer value, or false if it does not fit / is not
** integral. The hybrid representation is produced by lint64.fromFloat with
** the strict (mode 0) rounding mode.
*/
const lua_numbertointeger = function(n) {
    let r = fromFloat(n, 0);
    return r === null ? false : r;
};

const LUA_INTEGER_FRMLEN = "";
const LUA_NUMBER_FRMLEN = "";

const LUA_INTEGER_FMT = `%${LUA_INTEGER_FRMLEN}d`;
const LUA_NUMBER_FMT  = "%.14g";

const lua_getlocaledecpoint = function() {
    /* we hard-code the decimal point to '.' as a user cannot change the
       locale in most JS environments, and in that you can, a multi-byte
       locale is common.
    */
    return 46 /* '.'.charCodeAt(0) */;
};

/*
@@ LUAL_BUFFERSIZE is the buffer size used by the lauxlib buffer system.
*/
const LUAL_BUFFERSIZE = conf.LUAL_BUFFERSIZE || 8192;

// See: http://croquetweak.blogspot.fr/2014/08/deconstructing-floats-frexp-and-ldexp.html
// Decomposes a floating-point value into a normalized fraction (mantissa in [0.5, 1))
// and an integral power of two. Returns [mantissa, exponent] such that value === mantissa * 2^exponent.
const frexp = function(value) {
    if (value === 0) return [value, 0];
    const data = new DataView(new ArrayBuffer(8));
    data.setFloat64(0, value);
    let bits = (data.getUint32(0) >>> 20) & 0x7FF;
    if (bits === 0) { // subnormal (denormal) number: scale up first
        data.setFloat64(0, value * Math.pow(2, 64));  // exp + 64
        bits = ((data.getUint32(0) >>> 20) & 0x7FF) - 64;
    }
    const exponent = bits - 1022;
    const mantissa = ldexp(value, -exponent);
    return [mantissa, exponent];
};

// Multiplies mantissa by 2^exponent, avoiding overflow/underflow by splitting the
// exponent across multiple steps (each step is at most ~1023, staying within the
// double-precision exponent range of [-1022, 1023]).
const ldexp = function(mantissa, exponent) {
    if (mantissa === 0 || !isFinite(mantissa)) return mantissa;
    const steps = Math.min(3, Math.ceil(Math.abs(exponent) / 1023));
    let result = mantissa;
    for (let i = 0; i < steps; i++)
        result *= Math.pow(2, Math.floor((exponent + i) / steps));
    return result;
};

module.exports.LUAI_MAXSTACK          = LUAI_MAXSTACK;
module.exports.LUA_COMPAT_FLOATSTRING = LUA_COMPAT_FLOATSTRING;
module.exports.LUA_IDSIZE             = LUA_IDSIZE;
module.exports.LUA_INTEGER_FMT        = LUA_INTEGER_FMT;
module.exports.LUA_INTEGER_FRMLEN     = LUA_INTEGER_FRMLEN;
module.exports.LUA_MAXINTEGER         = LUA_MAXINTEGER;
module.exports.LUA_MININTEGER         = LUA_MININTEGER;
module.exports.LUA_NUMBER_FMT         = LUA_NUMBER_FMT;
module.exports.LUA_NUMBER_FRMLEN      = LUA_NUMBER_FRMLEN;
module.exports.LUAL_BUFFERSIZE        = LUAL_BUFFERSIZE;
module.exports.frexp                  = frexp;
module.exports.ldexp                  = ldexp;
module.exports.lua_getlocaledecpoint  = lua_getlocaledecpoint;
module.exports.lua_integer2str        = lua_integer2str;
module.exports.lua_number2str         = lua_number2str;
module.exports.lua_numbertointeger    = lua_numbertointeger;
