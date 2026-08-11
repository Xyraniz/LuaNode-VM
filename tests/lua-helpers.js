"use strict";

/*
** Test helper for running Lua code through the LuaNode-VM interpreter.
** Provides utilities to load and execute Lua snippets and retrieve
** return values as JavaScript values.
*/

const F = require("../src/fengari.js");
const { to_luastring, to_jsstring } = F;
const lua = F.lua;
const lauxlib = F.lauxlib;
const lualib = F.lualib;

/*
** Run a Lua snippet and return the top-of-stack value as a JS value.
** The snippet is wrapped so that `return ...` captures the result.
*/
function runLua(code) {
    const L = lauxlib.luaL_newstate();
    if (!L) throw new Error("Failed to create Lua state");
    lualib.luaL_openlibs(L);

    const status = lauxlib.luaL_loadstring(L, to_luastring(code));
    if (status !== lua.LUA_OK) {
        const msg = safeToJsString(lua.lua_tostring(L, -1));
        lua.lua_close(L);
        return { ok: false, error: `load: ${msg}` };
    }

    const runStatus = lua.lua_pcall(L, 0, -1, 0);  /* -1 = LUA_MULTRET: get all returns */
    if (runStatus !== lua.LUA_OK) {
        const msg = safeToJsString(lua.lua_tostring(L, -1));
        lua.lua_close(L);
        return { ok: false, error: `run: ${msg}` };
    }

    /* Collect all returned values, tab-separated (matching Lua's print) */
    const nresults = lua.lua_gettop(L);
    const values = [];
    for (let i = 1; i <= nresults; i++) {
        values.push(stringifyValue(L, i));
    }
    lua.lua_close(L);
    return { ok: true, value: values.join("\t"), values };
}

/*
** Run a Lua expression and return its string representation.
*/
function evalStr(expr) {
    const res = runLua("return " + expr);
    if (!res.ok) return res;
    return { ok: true, value: String(res.value) };
}

/*
** Stringify a Lua stack value the way Lua's print/tostring would:
** nil -> "nil", true/false -> "true"/"false", numbers as-is, etc.
*/
function stringifyValue(L, idx) {
    const t = lua.lua_type(L, idx);
    if (t === lua.LUA_TNIL) return "nil";
    if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, idx) ? "true" : "false";
    if (t === lua.LUA_TSTRING) return safeToJsString(lua.lua_tostring(L, idx));
    /* For numbers and other types, use lua_tolstring which gives Lua's repr */
    const s = lua.lua_tolstring(L, idx);
    return s ? safeToJsString(s) : "<unknown>";
}

/*
** Run Lua code that should error, and return the error message.
*/
function runLuaError(code) {
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);
    lauxlib.luaL_loadstring(L, to_luastring(code));
    const runStatus = lua.lua_pcall(L, 0, 0, 0);
    if (runStatus === lua.LUA_OK) {
        lua.lua_close(L);
        return { ok: false, error: "expected error but code succeeded" };
    }
    const msg = safeToJsString(lua.lua_tostring(L, -1));
    lua.lua_close(L);
    return { ok: true, message: msg };
}

/*
** Extract a JS value from a Lua stack slot.
*/
function getValue(L, idx) {
    const t = lua.lua_type(L, idx);
    if (t === lua.LUA_TNIL) return null;
    if (t === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, idx);
    if (t === lua.LUA_TNUMBER) {
        if (lua.lua_isinteger(L, idx)) {
            return lua.lua_tointeger(L, idx);
        }
        return lua.lua_tonumber(L, idx);
    }
    if (t === lua.LUA_TSTRING) {
        return safeToJsString(lua.lua_tostring(L, idx));
    }
    // For other types, return tostring representation
    const s = lua.lua_tostring(L, idx);
    return s ? safeToJsString(s) : `<type ${t}>`;
}

function safeToJsString(ls) {
    if (!ls) return "?";
    try {
        return to_jsstring(ls);
    } catch (e) {
        return "?";
    }
}

module.exports = { runLua, evalStr, runLuaError, getValue, safeToJsString };
