"use strict";

/*
** lcorolib.js — Coroutine library for the LuaNode-VM.
**
** Implements the Lua 5.3 'coroutine' standard library:
**   coroutine.create, coroutine.resume, coroutine.yield,
**   coroutine.status, coroutine.wrap, coroutine.isyieldable,
**   coroutine.running.
**
** Modernized: var → let/const, arrow functions for helpers,
** JSDoc on public entry points.
*/

const {
    LUA_OK,
    LUA_TFUNCTION,
    LUA_TSTRING,
    LUA_YIELD,
    lua_Debug,
    lua_checkstack,
    lua_concat,
    lua_error,
    lua_getstack,
    lua_gettop,
    lua_insert,
    lua_isyieldable,
    lua_newthread,
    lua_pop,
    lua_pushboolean,
    lua_pushcclosure,
    lua_pushliteral,
    lua_pushthread,
    lua_pushvalue,
    lua_resume,
    lua_status,
    lua_tothread,
    lua_type,
    lua_upvalueindex,
    lua_xmove,
    lua_yield
} = require('../lua.js');
const {
    luaL_argcheck,
    luaL_checktype,
    luaL_newlib,
    luaL_where
} = require('../lauxlib.js');

const getco = (L) => {
    const co = lua_tothread(L, 1);
    luaL_argcheck(L, co, 1, "thread expected");
    return co;
};

const auxresume = (L, co, narg) => {
    if (!lua_checkstack(co, narg)) {
        lua_pushliteral(L, "too many arguments to resume");
        return -1;
    }
    if (lua_status(co) === LUA_OK && lua_gettop(co) === 0) {
        lua_pushliteral(L, "cannot resume dead coroutine");
        return -1;
    }
    lua_xmove(L, co, narg);
    const status = lua_resume(co, L, narg);
    if (status === LUA_OK || status === LUA_YIELD) {
        const nres = lua_gettop(co);
        if (!lua_checkstack(L, nres + 1)) {
            lua_pop(co, nres);
            lua_pushliteral(L, "too many results to resume");
            return -1;
        }
        lua_xmove(co, L, nres);
        return nres;
    } else {
        lua_xmove(co, L, 1);
        return -1;
    }
};

const luaB_coresume = (L) => {
    const co = getco(L);
    const r = auxresume(L, co, lua_gettop(L) - 1);
    if (r < 0) {
        lua_pushboolean(L, 0);
        lua_insert(L, -2);
        return 2;
    } else {
        lua_pushboolean(L, 1);
        lua_insert(L, -(r + 1));
        return r + 1;
    }
};

const luaB_auxwrap = (L) => {
    const co = lua_tothread(L, lua_upvalueindex(1));
    const r = auxresume(L, co, lua_gettop(L));
    if (r < 0) {
        if (lua_type(L, -1) === LUA_TSTRING) {
            luaL_where(L, 1);
            lua_insert(L, -2);
            lua_concat(L, 2);
        }
        return lua_error(L);
    }
    return r;
};

const luaB_cocreate = (L) => {
    luaL_checktype(L, 1, LUA_TFUNCTION);
    const NL = lua_newthread(L);
    lua_pushvalue(L, 1);
    lua_xmove(L, NL, 1);
    return 1;
};

const luaB_cowrap = (L) => {
    luaB_cocreate(L);
    lua_pushcclosure(L, luaB_auxwrap, 1);
    return 1;
};

const luaB_yield = (L) => lua_yield(L, lua_gettop(L));

const luaB_costatus = (L) => {
    const co = getco(L);
    if (L === co) {
        lua_pushliteral(L, "running");
    } else {
        switch (lua_status(co)) {
            case LUA_YIELD:
                lua_pushliteral(L, "suspended");
                break;
            case LUA_OK: {
                const ar = new lua_Debug();
                if (lua_getstack(co, 0, ar) > 0)
                    lua_pushliteral(L, "normal");
                else if (lua_gettop(co) === 0)
                    lua_pushliteral(L, "dead");
                else
                    lua_pushliteral(L, "suspended");
                break;
            }
            default:
                lua_pushliteral(L, "dead");
                break;
        }
    }
    return 1;
};

const luaB_yieldable = (L) => {
    lua_pushboolean(L, lua_isyieldable(L));
    return 1;
};

const luaB_corunning = (L) => {
    lua_pushboolean(L, lua_pushthread(L));
    return 2;
};

const co_funcs = {
    "create":      luaB_cocreate,
    "isyieldable": luaB_yieldable,
    "resume":      luaB_coresume,
    "running":     luaB_corunning,
    "status":      luaB_costatus,
    "wrap":        luaB_cowrap,
    "yield":       luaB_yield
};

/**
 * Open the coroutine library.
 * @returns {number} 1 (pushes the coroutine table)
 */
const luaopen_coroutine = (L) => {
    luaL_newlib(L, co_funcs);
    return 1;
};

module.exports.luaopen_coroutine = luaopen_coroutine;
