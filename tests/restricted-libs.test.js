"use strict";

const F = require("../src/fengari.js");

const evaluate = (L, source) => {
    const status = F.lauxlib.luaL_loadstring(L, F.to_luastring(source));
    if (status !== F.lua.LUA_OK)
        throw new Error(F.to_jsstring(F.lua.lua_tostring(L, -1)));
    const callStatus = F.lua.lua_pcall(L, 0, 1, 0);
    if (callStatus !== F.lua.LUA_OK)
        throw new Error(F.to_jsstring(F.lua.lua_tostring(L, -1)));
    const result = F.to_jsstring(F.lua.lua_tostring(L, -1));
    F.lua.lua_settop(L, 0);
    return result;
};

describe("optional minimal standard-library profile", () => {
    test("removes host integration and file-loading functions", () => {
        const L = F.lauxlib.luaL_newstate();
        try {
            F.lualib.luaL_openlibs(L, { hostAccess: false });
            expect(evaluate(L,
                "local names={'math','string','table','utf8','coroutine','io','os','package','debug','fengari','require','dofile','loadfile'}; " +
                "local result={}; for i,name in ipairs(names) do result[i]=tostring(_G[name] ~= nil) end; " +
                "return table.concat(result, ':')"
            )).toBe("true:true:true:true:true:false:false:false:false:false:false:false:false");
        } finally {
            F.lua.lua_close(L);
        }
    });

    test("default openlibs retains the full standard-library behavior", () => {
        const L = F.lauxlib.luaL_newstate();
        try {
            F.lualib.luaL_openlibs(L);
            expect(evaluate(L,
                "return tostring(io ~= nil and os ~= nil and package ~= nil and debug ~= nil and dofile ~= nil and loadfile ~= nil)"
            )).toBe("true");
        } finally {
            F.lua.lua_close(L);
        }
    });
});
