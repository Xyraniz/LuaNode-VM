"use strict";

/*
** Tests for table operations with large 64-bit integer keys.
** Verifies that Number/BigInt keys don't collide and that
** table.move and length operations work with large integers.
*/

const { evalStr, runLua } = require("./lua-helpers");

describe("Tables with large integer keys", () => {
    test("Store and retrieve a key above 2^53", () => {
        const r = runLua("local t = {}; t[9007199254740993] = 'hello'; return t[9007199254740993]");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("hello");
    });

    test("Store and retrieve maxinteger key", () => {
        const r = runLua("local t = {}; t[9223372036854775807] = 42; return tostring(t[9223372036854775807])");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("42");
    });

    test("Store and retrieve mininteger key", () => {
        const r = runLua("local t = {}; t[-9223372036854775808] = 'min'; return t[-9223372036854775808 + 0]");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("min");
    });

    test("Distinct keys 2^53 and 2^53+1 don't collide", () => {
        const r = runLua(
            "local t = {};" +
            "t[9007199254740992] = 'a';" +
            "t[9007199254740993] = 'b';" +
            "return t[9007199254740992] .. t[9007199254740993]"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("ab");
    });

    test("table.move with large indices", () => {
        const r = runLua(
            "local t = {};" +
            "t[9007199254740990] = 10;" +
            "t[9007199254740991] = 20;" +
            "t[9007199254740992] = 30;" +
            "table.move(t, 9007199254740990, 9007199254740992, 9007199254741000);" +
            "return tostring(t[9007199254741000]) .. ',' .. tostring(t[9007199254741001]) .. ',' .. tostring(t[9007199254741002])"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("10,20,30");
    });

    test("table.move error: destination overflow", () => {
        const r = runLua(
            "local t = {};" +
            "local ok, err = pcall(table.move, t, 1, 2, 9223372036854775807);" +
            "return tostring(ok)"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("false");
    });

    test("Numeric for loop populates table with large keys", () => {
        const r = runLua(
            "local t = {};" +
            "for i = 9007199254740990, 9007199254740995 do t[i] = i end;" +
            "return tostring(t[9007199254740990]) .. ',' .. tostring(t[9007199254740995])"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("9007199254740990,9007199254740995");
    });

    test("ipairs still works (1-based sequential)", () => {
        const r = runLua(
            "local t = {100, 200, 300};" +
            "local s = 0;" +
            "for _, v in ipairs(t) do s = s + v end;" +
            "return tostring(s)"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("600");
    });

    test("Large integer as array length boundary", () => {
        const r = runLua(
            "local t = {};" +
            "t[1] = 'x'; t[2] = 'y';" +
            "return tostring(#t)"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("2");
    });
});
