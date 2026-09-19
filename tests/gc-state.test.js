"use strict";

const F = require("../src/fengari.js");

const newOpenState = () => {
    const L = F.lauxlib.luaL_newstate();
    F.lualib.luaL_openlibs(L);
    return L;
};

const run = (L, source, nresults = 0) => {
    const loadStatus = F.lauxlib.luaL_loadstring(L, F.to_luastring(source));
    if (loadStatus !== F.lua.LUA_OK)
        throw new Error(F.to_jsstring(F.lua.lua_tostring(L, -1)));
    const callStatus = F.lua.lua_pcall(L, 0, nresults, 0);
    if (callStatus !== F.lua.LUA_OK)
        throw new Error(F.to_jsstring(F.lua.lua_tostring(L, -1)));
    const result = nresults ? F.to_jsstring(F.lua.lua_tostring(L, -1)) : undefined;
    F.lua.lua_settop(L, 0);
    return result;
};

describe("per-state Lua object collector", () => {
    test("collecting one state preserves weak tables owned by another", () => {
        const first = newOpenState();
        const second = newOpenState();
        try {
            run(second,
                "local weak = setmetatable({}, {__mode='k'}); " +
                "local key = {}; weak[key] = 7; _G.weak, _G.key = weak, key");
            run(first, "collectgarbage('collect')");
            expect(run(second, "return weak[key]", 1)).toBe("7");
        } finally {
            F.lua.lua_close(first);
            F.lua.lua_close(second);
        }
    });

    test("stop and restart affect only the selected state", () => {
        const first = newOpenState();
        const second = newOpenState();
        try {
            run(first, "collectgarbage('stop')");
            expect(run(first, "return tostring(collectgarbage('isrunning'))", 1)).toBe("false");
            expect(run(second, "return tostring(collectgarbage('isrunning'))", 1)).toBe("true");
            run(first, "collectgarbage('restart')");
            expect(run(first, "return tostring(collectgarbage('isrunning'))", 1)).toBe("true");
        } finally {
            F.lua.lua_close(first);
            F.lua.lua_close(second);
        }
    });

    test("GC pause and step multiplier are per-state settings", () => {
        const first = newOpenState();
        const second = newOpenState();
        try {
            expect(run(first,
                "return tostring(collectgarbage('setpause', 150)) .. ':' .. " +
                "tostring(collectgarbage('setstepmul', 250))", 1)).toBe("200:100");
            expect(run(first,
                "return tostring(collectgarbage('setpause', 300)) .. ':' .. " +
                "tostring(collectgarbage('setstepmul', 350))", 1)).toBe("150:250");
            expect(run(second,
                "return tostring(collectgarbage('setpause', 400)) .. ':' .. " +
                "tostring(collectgarbage('setstepmul', 450))", 1)).toBe("200:100");
        } finally {
            F.lua.lua_close(first);
            F.lua.lua_close(second);
        }
    });

    test("collecting unreachable userdata runs its finalizer exactly once", () => {
        const L = newOpenState();
        const gc = L.l_G.gc;
        const finalized = { count: 0 };
        const before = new Set(gc.userdatas);
        try {
            F.lua.lua_newuserdata(L, 0);
            F.lua.lua_newtable(L);
            F.lua.lua_pushcfunction(L, () => {
                finalized.count++;
                return 0;
            });
            F.lua.lua_setfield(L, -2, F.to_luastring("__gc"));
            F.lua.lua_setmetatable(L, -2);
            const userdata = Array.from(gc.userdatas).find((item) => !before.has(item));
            expect(userdata).toBeDefined();

            F.lua.lua_settop(L, 0);
            run(L, "collectgarbage('collect')");
            expect(finalized.count).toBe(1);
            expect(userdata.finalized).toBe(true);
            expect(gc.userdatas.has(userdata)).toBe(false);

            run(L, "collectgarbage('collect')");
            expect(finalized.count).toBe(1);
        } finally {
            F.lua.lua_close(L);
        }
    });

    test("closing a state runs table and userdata finalizers and releases its registry", () => {
        const L = newOpenState();
        const gc = L.l_G.gc;
        const finalized = { count: 0 };
        F.lua.lua_pushcfunction(L, () => {
            finalized.count++;
            return 0;
        });
        F.lua.lua_setglobal(L, F.to_luastring("mark_finalized"));
        run(L, "do local object = setmetatable({}, {__gc=function() mark_finalized() end}) end");
        expect(gc.tables.size).toBeGreaterThan(0);

        F.lua.lua_newuserdata(L, 0);
        F.lua.lua_newtable(L);
        F.lua.lua_pushcfunction(L, () => {
            finalized.count++;
            return 0;
        });
        F.lua.lua_setfield(L, -2, F.to_luastring("__gc"));
        F.lua.lua_setmetatable(L, -2);
        F.lua.lua_settop(L, 0);

        F.lua.lua_close(L);

        expect(finalized.count).toBe(2);
        expect(gc.closed).toBe(true);
        expect(gc.tables.size).toBe(0);
        expect(gc.userdatas.size).toBe(0);
        expect(L.l_G.l_registry.ttisnil()).toBe(true);
        expect(L.stack).toBeNull();
    });
});
