"use strict";

/*
** ldblib.js — Debug library for the LuaNode-VM.
**
** Implements the Lua 5.3 'debug' standard library:
**   debug.getinfo, debug.getlocal, debug.setlocal,
**   debug.getupvalue, debug.setupvalue, debug.sethook,
**   debug.gethook, debug.traceback, debug.getregistry,
**   debug.getmetatable, debug.setmetatable, debug.getuservalue,
**   debug.setuservalue, debug.upvalueid, debug.upvaluejoin,
**   debug.debug.
**
** Modernized: const/let, arrow functions for helpers,
** JSDoc on public entry points.
*/

const {
    LUA_MASKCALL,
    LUA_MASKCOUNT,
    LUA_MASKLINE,
    LUA_MASKRET,
    LUA_REGISTRYINDEX,
    LUA_TFUNCTION,
    LUA_TNIL,
    LUA_TTABLE,
    LUA_TUSERDATA,
    lua_Debug,
    lua_call,
    lua_checkstack,
    lua_gethook,
    lua_gethookcount,
    lua_gethookmask,
    lua_getinfo,
    lua_getlocal,
    lua_getmetatable,
    lua_getstack,
    lua_getupvalue,
    lua_getuservalue,
    lua_insert,
    lua_iscfunction,
    lua_isfunction,
    lua_isnoneornil,
    lua_isthread,
    lua_newtable,
    lua_pcall,
    lua_pop,
    lua_pushboolean,
    lua_pushfstring,
    lua_pushinteger,
    lua_pushlightuserdata,
    lua_pushliteral,
    lua_pushnil,
    lua_pushstring,
    lua_pushvalue,
    lua_rawgetp,
    lua_rawsetp,
    lua_rotate,
    lua_setfield,
    lua_sethook,
    lua_setlocal,
    lua_setmetatable,
    lua_settop,
    lua_setupvalue,
    lua_setuservalue,
    lua_tojsstring,
    lua_toproxy,
    lua_tostring,
    lua_tothread,
    lua_touserdata,
    lua_type,
    lua_upvalueid,
    lua_upvaluejoin,
    lua_xmove
} = require('../lua.js');
const {
    luaL_argcheck,
    luaL_argerror,
    luaL_checkany,
    luaL_checkinteger,
    luaL_checkstring,
    luaL_checktype,
    luaL_error,
    luaL_loadbuffer,
    luaL_newlib,
    luaL_optinteger,
    luaL_optstring,
    luaL_traceback,
    lua_writestringerror
} = require('../lauxlib.js');
const lualib = require('./lualib.js');
const {
    luastring_indexOf,
    to_luastring
} = require("../fengaricore.js");

/*
** If L1 != L, L1 can be in any state, and therefore there are no
** guarantees about its stack space; any push in L1 must be checked.
*/
const checkstack = (L, L1, n) => {
    if (L !== L1 && !lua_checkstack(L1, n))
        luaL_error(L, to_luastring("stack overflow", true));
};

const db_getregistry = (L) => {
    lua_pushvalue(L, LUA_REGISTRYINDEX);
    return 1;
};

const db_getmetatable = (L) => {
    luaL_checkany(L, 1);
    if (!lua_getmetatable(L, 1))
        lua_pushnil(L);
    return 1;
};

const db_setmetatable = (L) => {
    const t = lua_type(L, 2);
    luaL_argcheck(L, t == LUA_TNIL || t == LUA_TTABLE, 2, "nil or table expected");
    lua_settop(L, 2);
    lua_setmetatable(L, 1);
    return 1;
};

const db_getuservalue = (L) => {
    if (lua_type(L, 1) !== LUA_TUSERDATA)
        lua_pushnil(L);
    else
        lua_getuservalue(L, 1);
    return 1;
};

const db_setuservalue = (L) => {
    luaL_checktype(L, 1, LUA_TUSERDATA);
    luaL_checkany(L, 2);
    lua_settop(L, 2);
    lua_setuservalue(L, 1);
    return 1;
};

const getthread = (L) => {
    if (lua_isthread(L, 1)) {
        return { arg: 1, thread: lua_tothread(L, 1) };
    }
    return { arg: 0, thread: L };
};

const settabss = (L, k, v) => {
    lua_pushstring(L, v);
    lua_setfield(L, -2, k);
};

const settabsi = (L, k, v) => {
    lua_pushinteger(L, v);
    lua_setfield(L, -2, k);
};

const settabsb = (L, k, v) => {
    lua_pushboolean(L, v);
    lua_setfield(L, -2, k);
};

const treatstackoption = (L, L1, fname) => {
    if (L == L1)
        lua_rotate(L, -2, 1);
    else
        lua_xmove(L1, L, 1);
    lua_setfield(L, -2, fname);
};

const db_getinfo = (L) => {
    const ar = new lua_Debug();
    const thread = getthread(L);
    const arg = thread.arg;
    const L1 = thread.thread;
    let options = luaL_optstring(L, arg + 2, "flnStu");
    checkstack(L, L1, 3);
    if (lua_isfunction(L, arg + 1)) {
        options = lua_pushfstring(L, to_luastring(">%s"), options);
        lua_pushvalue(L, arg + 1);
        lua_xmove(L, L1, 1);
    } else {
        if (!lua_getstack(L1, luaL_checkinteger(L, arg + 1), ar)) {
            lua_pushnil(L);
            return 1;
        }
    }
    if (!lua_getinfo(L1, options, ar))
        luaL_argerror(L, arg + 2, "invalid option");
    lua_newtable(L);
    if (luastring_indexOf(options, 83 /* 'S' */) > -1) {
        settabss(L, to_luastring("source", true), ar.source);
        settabss(L, to_luastring("short_src", true), ar.short_src);
        settabsi(L, to_luastring("linedefined", true), ar.linedefined);
        settabsi(L, to_luastring("lastlinedefined", true), ar.lastlinedefined);
        settabss(L, to_luastring("what", true), ar.what);
    }
    if (luastring_indexOf(options, 108 /* 'l' */) > -1)
        settabsi(L, to_luastring("currentline", true), ar.currentline);
    if (luastring_indexOf(options, 117 /* 'u' */) > -1) {
        settabsi(L, to_luastring("nups", true), ar.nups);
        settabsi(L, to_luastring("nparams", true), ar.nparams);
        settabsb(L, to_luastring("isvararg", true), ar.isvararg);
    }
    if (luastring_indexOf(options, 110 /* 'n' */) > -1) {
        settabss(L, to_luastring("name", true), ar.name);
        settabss(L, to_luastring("namewhat", true), ar.namewhat);
    }
    if (luastring_indexOf(options, 116 /* 't' */) > -1)
        settabsb(L, to_luastring("istailcall", true), ar.istailcall);
    if (luastring_indexOf(options, 76 /* 'L' */) > -1)
        treatstackoption(L, L1, to_luastring("activelines", true));
    if (luastring_indexOf(options, 102 /* 'f' */) > -1)
        treatstackoption(L, L1, to_luastring("func", true));
    return 1;
};

const db_getlocal = (L) => {
    const thread = getthread(L);
    const L1 = thread.thread;
    const arg = thread.arg;
    const ar = new lua_Debug();
    const nvar = luaL_checkinteger(L, arg + 2);
    if (lua_isfunction(L, arg + 1)) {
        lua_pushvalue(L, arg + 1);
        lua_pushstring(L, lua_getlocal(L, null, nvar));
        return 1;
    } else {
        const level = luaL_checkinteger(L, arg + 1);
        if (!lua_getstack(L1, level, ar))
            return luaL_argerror(L, arg+1, "level out of range");
        checkstack(L, L1, 1);
        const name = lua_getlocal(L1, ar, nvar);
        if (name) {
            lua_xmove(L1, L, 1);
            lua_pushstring(L, name);
            lua_rotate(L, -2, 1);
            return 2;
        } else {
            lua_pushnil(L);
            return 1;
        }
    }
};

const db_setlocal = (L) => {
    const thread = getthread(L);
    const L1 = thread.thread;
    const arg = thread.arg;
    const ar = new lua_Debug();
    const level = luaL_checkinteger(L, arg + 1);
    const nvar = luaL_checkinteger(L, arg + 2);
    if (!lua_getstack(L1, level, ar))
        return luaL_argerror(L, arg + 1, "level out of range");
    luaL_checkany(L, arg + 3);
    lua_settop(L, arg + 3);
    checkstack(L, L1, 1);
    lua_xmove(L, L1, 1);
    const name = lua_setlocal(L1, ar, nvar);
    if (name === null)
        lua_pop(L1, 1);
    lua_pushstring(L, name);
    return 1;
};

const auxupvalue = (L, get) => {
    const n = luaL_checkinteger(L, 2);
    luaL_checktype(L, 1, LUA_TFUNCTION);
    const name = get ? lua_getupvalue(L, 1, n) : lua_setupvalue(L, 1, n);
    if (name === null) return 0;
    lua_pushstring(L, name);
    lua_insert(L, -(get+1));
    return get + 1;
};

const db_getupvalue = (L) => auxupvalue(L, 1);

const db_setupvalue = (L) => {
    luaL_checkany(L, 3);
    return auxupvalue(L, 0);
};

const checkupval = (L, argf, argnup) => {
    const nup = luaL_checkinteger(L, argnup);
    luaL_checktype(L, argf, LUA_TFUNCTION);
    luaL_argcheck(L, (lua_getupvalue(L, argf, nup) !== null), argnup, "invalid upvalue index");
    return nup;
};

const db_upvalueid = (L) => {
    const n = checkupval(L, 1, 2);
    lua_pushlightuserdata(L, lua_upvalueid(L, 1, n));
    return 1;
};

const db_upvaluejoin = (L) => {
    const n1 = checkupval(L, 1, 2);
    const n2 = checkupval(L, 3, 4);
    luaL_argcheck(L, !lua_iscfunction(L, 1), 1, "Lua function expected");
    luaL_argcheck(L, !lua_iscfunction(L, 3), 3, "Lua function expected");
    lua_upvaluejoin(L, 1, n1, 3, n2);
    return 0;
};

const HOOKKEY = to_luastring("__hooks__", true);
const hooknames = ["call", "return", "line", "count", "tail call"].map(e => to_luastring(e));

const hookf = (L, ar) => {
    lua_rawgetp(L, LUA_REGISTRYINDEX, HOOKKEY);
    const hooktable = lua_touserdata(L, -1);
    const proxy = hooktable.get(L);
    if (proxy) {
        proxy(L);
        lua_pushstring(L, hooknames[ar.event]);
        if (ar.currentline >= 0)
            lua_pushinteger(L, ar.currentline);
        else
            lua_pushnil(L);
        lualib.lua_assert(lua_getinfo(L, to_luastring("lS"), ar));
        lua_call(L, 2, 0);
    }
};

const makemask = (smask, count) => {
    let mask = 0;
    if (luastring_indexOf(smask, 99 /* 'c' */) > -1) mask |= LUA_MASKCALL;
    if (luastring_indexOf(smask, 114 /* 'r' */) > -1) mask |= LUA_MASKRET;
    if (luastring_indexOf(smask, 108 /* 'l' */) > -1) mask |= LUA_MASKLINE;
    if (count > 0) mask |= LUA_MASKCOUNT;
    return mask;
};

const unmakemask = (mask, smask) => {
    let i = 0;
    if (mask & LUA_MASKCALL) smask[i++] = 99 /* 'c' */;
    if (mask & LUA_MASKRET) smask[i++] = 114 /* 'r' */;
    if (mask & LUA_MASKLINE) smask[i++] = 108 /* 'l' */;
    return smask.subarray(0, i);
};

const db_sethook = (L) => {
    let mask, count, func;
    const thread = getthread(L);
    const L1 = thread.thread;
    const arg = thread.arg;
    if (lua_isnoneornil(L, arg+1)) {
        lua_settop(L, arg+1);
        func = null; mask = 0; count = 0;
    } else {
        const smask = luaL_checkstring(L, arg + 2);
        luaL_checktype(L, arg+1, LUA_TFUNCTION);
        count = luaL_optinteger(L, arg + 3, 0);
        func = hookf; mask = makemask(smask, count);
    }
    let hooktable;
    if (lua_rawgetp(L, LUA_REGISTRYINDEX, HOOKKEY) === LUA_TNIL) {
        hooktable = new WeakMap();
        lua_pushlightuserdata(L, hooktable);
        lua_rawsetp(L, LUA_REGISTRYINDEX, HOOKKEY);
    } else {
        hooktable = lua_touserdata(L, -1);
    }
    const proxy = lua_toproxy(L, arg + 1);
    hooktable.set(L1, proxy);
    lua_sethook(L1, func, mask, count);
    return 0;
};

const db_gethook = (L) => {
    const thread = getthread(L);
    const L1 = thread.thread;
    const buff = new Uint8Array(5);
    const mask = lua_gethookmask(L1);
    const hook = lua_gethook(L1);
    if (hook === null)
        lua_pushnil(L);
    else if (hook !== hookf)
        lua_pushliteral(L, "external hook");
    else {
        lua_rawgetp(L, LUA_REGISTRYINDEX, HOOKKEY);
        const hooktable = lua_touserdata(L, -1);
        const proxy = hooktable.get(L1);
        proxy(L);
    }
    lua_pushstring(L, unmakemask(mask, buff));
    lua_pushinteger(L, lua_gethookcount(L1));
    return 3;
};

const db_traceback = (L) => {
    const thread = getthread(L);
    const L1 = thread.thread;
    const arg = thread.arg;
    const msg = lua_tostring(L, arg + 1);
    if (msg === null && !lua_isnoneornil(L, arg + 1))
        lua_pushvalue(L, arg + 1);
    else {
        const level = luaL_optinteger(L, arg + 2, L === L1 ? 1 : 0);
        luaL_traceback(L, L1, msg, level);
    }
    return 1;
};

const dblib = {
    "gethook":      db_gethook,
    "getinfo":      db_getinfo,
    "getlocal":     db_getlocal,
    "getmetatable": db_getmetatable,
    "getregistry":  db_getregistry,
    "getupvalue":   db_getupvalue,
    "getuservalue": db_getuservalue,
    "sethook":      db_sethook,
    "setlocal":     db_setlocal,
    "setmetatable": db_setmetatable,
    "setupvalue":   db_setupvalue,
    "setuservalue": db_setuservalue,
    "traceback":    db_traceback,
    "upvalueid":    db_upvalueid,
    "upvaluejoin":  db_upvaluejoin
};

let getinput;
if (typeof process !== "undefined") {
    const readlineSync = require('readline-sync');
    readlineSync.setDefaultOptions({ prompt: 'lua_debug> ' });
    getinput = () => readlineSync.prompt();
} else if (typeof window !== "undefined") {
    getinput = () => {
        const input = prompt("lua_debug>", "");
        return (input !== null) ? input : "";
    };
}
if (getinput) {
    dblib.debug = (L) => {
        for (;;) {
            const input = getinput();
            if (input === "cont")
                return 0;
            if (input.length === 0)
                continue;
            const buffer = to_luastring(input);
            if (luaL_loadbuffer(L, buffer, buffer.length, to_luastring("=(debug command)", true))
                || lua_pcall(L, 0, 0, 0)) {
                lua_writestringerror(lua_tojsstring(L, -1), "\n");
            }
            lua_settop(L, 0);
        }
    };
}

/**
 * Open the debug library.
 * @returns {number} 1 (pushes the debug table)
 */
const luaopen_debug = (L) => {
    luaL_newlib(L, dblib);
    return 1;
};

module.exports.luaopen_debug = luaopen_debug;
