#!/usr/bin/env node
"use strict";

/*
** LuaNode-VM CLI runner.
** Executes Lua 5.3 scripts from the command line.
**
** Usage:
**   node cli/luanode.js script.lua [args...]
**   node cli/luanode.js -e "lua_code"
**   node cli/luanode.js -v   (print version)
**
** The Lua script can access command-line arguments via the global
** table `arg`, where arg[0] is the script name and arg[1..n] are
** the remaining arguments (matching PUC-Rio Lua's convention).
*/

const fs = require("fs");
const path = require("path");
const F = require("../src/fengari.js");

const { to_luastring, to_jsstring } = F;
const lua = F.lua;
const lauxlib = F.lauxlib;
const lualib = F.lualib;

function printUsage() {
    process.stderr.write([
        "LuaNode-VM — Lua 5.3 Virtual Machine in JavaScript",
        "",
        "Usage:",
        "  luanode [options] [script [args...]]",
        "  luanode -e stat",
        "",
        "Options:",
        "  -e stat   execute string 'stat'",
        "  -v        show version information",
        "  -h        show this help message",
        "",
    ].join("\n") + "\n");
}

function createArgTable(L, scriptName, args) {
    /* Create the 'arg' table: arg[0] = script name, arg[1..n] = args */
    lua.lua_createtable(L, args.length, 1);
    for (let i = 0; i < args.length; i++) {
        lua.lua_pushstring(L, to_luastring(args[i]));
        lua.lua_seti(L, -2, i + 1);
    }
    lua.lua_pushstring(L, to_luastring(scriptName));
    lua.lua_seti(L, -2, 0);
    lua.lua_setglobal(L, to_luastring("arg"));
}

function runString(code, chunkName) {
    const L = lauxlib.luaL_newstate();
    if (!L) {
        process.stderr.write("Error: failed to create Lua state\n");
        process.exit(1);
    }
    lualib.luaL_openlibs(L);

    const status = lauxlib.luaL_loadbuffer(L, to_luastring(code), to_luastring(chunkName));
    if (status !== lua.LUA_OK) {
        const msg = safeToJsString(lua.lua_tostring(L, -1));
        process.stderr.write("luanode: " + msg + "\n");
        lua.lua_close(L);
        process.exit(1);
    }

    const runStatus = lua.lua_pcall(L, 0, 0, 0);
    if (runStatus !== lua.LUA_OK) {
        const msg = safeToJsString(lua.lua_tostring(L, -1));
        process.stderr.write("luanode: " + msg + "\n");
        lua.lua_close(L);
        process.exit(1);
    }

    lua.lua_close(L);
}

function runFile(filePath, scriptArgs) {
    let code;
    try {
        code = fs.readFileSync(filePath, "utf8");
    } catch (e) {
        process.stderr.write("luanode: cannot open " + filePath + ": " + e.message + "\n");
        process.exit(1);
    }

    const L = lauxlib.luaL_newstate();
    if (!L) {
        process.stderr.write("Error: failed to create Lua state\n");
        process.exit(1);
    }
    lualib.luaL_openlibs(L);

    /* Set up the arg table */
    createArgTable(L, path.basename(filePath), scriptArgs);

    const chunkName = "@" + filePath;
    const status = lauxlib.luaL_loadbuffer(L, to_luastring(code), to_luastring(chunkName));
    if (status !== lua.LUA_OK) {
        const msg = safeToJsString(lua.lua_tostring(L, -1));
        process.stderr.write("luanode: " + msg + "\n");
        lua.lua_close(L);
        process.exit(1);
    }

    const runStatus = lua.lua_pcall(L, 0, 0, 0);
    if (runStatus !== lua.LUA_OK) {
        const msg = safeToJsString(lua.lua_tostring(L, -1));
        process.stderr.write("luanode: " + msg + "\n");
        lua.lua_close(L);
        process.exit(1);
    }

    lua.lua_close(L);
}

function safeToJsString(ls) {
    if (!ls) return "(no error message)";
    try {
        return to_jsstring(ls);
    } catch (e) {
        return "(error message not convertible)";
    }
}

function main() {
    const argv = process.argv.slice(2);

    if (argv.length === 0) {
        /* No arguments — could start REPL, but for simplicity show usage */
        printUsage();
        process.exit(0);
    }

    /* Parse options */
    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === "-v" || arg === "--version") {
            const pkg = require("../package.json");
            process.stdout.write("LuaNode-VM " + pkg.version + "  (Lua 5.3 VM in JavaScript)\n");
            process.exit(0);
        } else if (arg === "-h" || arg === "--help") {
            printUsage();
            process.exit(0);
        } else if (arg === "-e") {
            i++;
            if (i >= argv.length) {
                process.stderr.write("luanode: -e needs an argument\n");
                process.exit(1);
            }
            runString(argv[i], "=(command line)");
            process.exit(0);
        } else if (arg.startsWith("-")) {
            process.stderr.write("luanode: unrecognized option: " + arg + "\n");
            process.exit(1);
        } else {
            /* First non-option argument is the script file */
            const scriptPath = arg;
            const scriptArgs = argv.slice(i + 1);
            runFile(scriptPath, scriptArgs);
            process.exit(0);
        }
        i++;
    }
}

main();
