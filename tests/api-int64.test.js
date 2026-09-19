"use strict";

const F = require("../src/fengari.js");
const I64 = require("../src/vm/lint64.js");

describe("signed int64 API boundaries", () => {
    test("normalization rejects integers outside signed int64", () => {
        expect(I64.normalize(1e20)).toBeNull();
        expect(I64.normalize(1e21)).toBeNull();
        expect(I64.normalize(1n << 63n)).toBeNull();
        expect(I64.normalize(-(1n << 63n) - 1n)).toBeNull();
        expect(I64.normalize(-(1n << 63n))).toBe(I64.MIN_INT64);
        expect(I64.isIntRep(1n << 63n)).toBe(false);
    });

    test("lua_pushinteger rejects out-of-range input and canonicalizes valid input", () => {
        const L = F.lauxlib.luaL_newstate();
        try {
            expect(() => F.lua.lua_pushinteger(L, 1n << 63n)).toThrow(TypeError);
            F.lua.lua_pushinteger(L, 9007199254740992);
            expect(L.stack[L.top - 1].value).toBe(9007199254740992n);
        } finally {
            F.lua.lua_close(L);
        }
    });

    test("raw integer table API accepts BigInt indices", () => {
        const L = F.lauxlib.luaL_newstate();
        try {
            F.lua.lua_createtable(L, 0, 0);
            F.lua.lua_pushstring(L, F.to_luastring("found"));
            F.lua.lua_rawseti(L, -2, I64.MAX_INT64);
            F.lua.lua_rawgeti(L, -1, I64.MAX_INT64);
            expect(F.to_jsstring(F.lua.lua_tostring(L, -1))).toBe("found");
        } finally {
            F.lua.lua_close(L);
        }
    });
});
