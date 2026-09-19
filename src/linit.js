"use strict";

const { lua_pop, lua_pushnil, lua_setglobal } = require('./lua.js');
const { luaL_requiref } = require('./lauxlib.js');
const { to_luastring } = require("./fengaricore.js");

const loadedlibs = {};
const minimalLibs = new Set(["_G", "coroutine", "math", "string", "table", "utf8"]);

/* export before requiring lualib.js */
const luaL_openlibs = function(L, options) {
    const hostAccess = !options || options.hostAccess !== false;
    /* "require" functions from 'loadedlibs' and set results to global table */
    for (let lib in loadedlibs) {
        if (!hostAccess && !minimalLibs.has(lib)) continue;
        luaL_requiref(L, to_luastring(lib), loadedlibs[lib], 1);
        lua_pop(L, 1); /* remove lib */
    }
    if (!hostAccess) {
        /* Base-library file loaders remain present without io/package. */
        for (const name of ["dofile", "loadfile"]) {
            lua_pushnil(L);
            lua_setglobal(L, to_luastring(name));
        }
    }
};
module.exports.luaL_openlibs = luaL_openlibs;

const lualib = require('./stdlib/lualib.js');
const { luaopen_base }      = require('./stdlib/lbaselib.js');
const { luaopen_coroutine } = require('./stdlib/lcorolib.js');
const { luaopen_debug }     = require('./stdlib/ldblib.js');
const { luaopen_math }      = require('./stdlib/lmathlib.js');
const { luaopen_package }   = require('./stdlib/loadlib.js');
const { luaopen_os }        = require('./stdlib/loslib.js');
const { luaopen_string }    = require('./stdlib/lstrlib.js');
const { luaopen_table }     = require('./stdlib/ltablib.js');
const { luaopen_utf8 }      = require('./stdlib/lutf8lib.js');

loadedlibs["_G"] = luaopen_base,
loadedlibs[lualib.LUA_LOADLIBNAME] = luaopen_package;
loadedlibs[lualib.LUA_COLIBNAME] = luaopen_coroutine;
loadedlibs[lualib.LUA_TABLIBNAME] = luaopen_table;
loadedlibs[lualib.LUA_OSLIBNAME] = luaopen_os;
loadedlibs[lualib.LUA_STRLIBNAME] = luaopen_string;
loadedlibs[lualib.LUA_MATHLIBNAME] = luaopen_math;
loadedlibs[lualib.LUA_UTF8LIBNAME] = luaopen_utf8;
loadedlibs[lualib.LUA_DBLIBNAME] = luaopen_debug;
if (typeof process !== "undefined")
    loadedlibs[lualib.LUA_IOLIBNAME] = require('./stdlib/liolib.js').luaopen_io;

/* Extension: fengari library */
const { luaopen_fengari } = require('./fengarilib.js');
loadedlibs[lualib.LUA_FENGARILIBNAME] = luaopen_fengari;
