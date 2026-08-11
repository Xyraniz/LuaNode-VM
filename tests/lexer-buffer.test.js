"use strict";

/*
** Regression tests for the lexer token-buffer bug (August 2026).
**
** Root cause: MAX_INT was changed from a JS Number to a BigInt (the real
** 2^63-1) to support true 64-bit integers, but the lexer's `save()` did
** `b.buffer.length >= MAX_INT/2`, mixing a Number with a BigInt under
** arithmetic — which throws `TypeError: Cannot mix BigInt and other types`.
** That line only ran the FIRST time a token needed to grow past
** LUA_MINBUFFER (32 bytes), so *every* string / identifier / comment /
** error message of ~31+ characters silently killed the interpreter
** (status -1, "no error message"). This is the most common case in real
** Lua scripting, so it effectively rendered LuaNode-VM unusable.
**
** These tests guarantee the fix holds: string literals of any length,
** with and without escape sequences, parse and execute correctly, and
** the lexer grows its buffer past 32 bytes without raising.
**
** Also covered: collectgarbage() must not raise "lua_gc not implemented"
** (it is delegated to the host JS garbage collector as a benign no-op).
*/

const { evalStr, runLua, runLuaError } = require("./lua-helpers");

describe("Lexer token-buffer growth (the 32-byte crash bug)", () => {
    test("string of exactly 30 chars (under the old threshold)", () => {
        const s = "x".repeat(30);
        expect(evalStr(`"${s}"`).value).toBe(s);
    });

    test("string of exactly 31 chars (first grow past LUA_MINBUFFER)", () => {
        const s = "x".repeat(31);
        expect(evalStr(`"${s}"`).value).toBe(s);
    });

    test("string of exactly 32 chars (LUA_MINBUFFER)", () => {
        const s = "x".repeat(32);
        expect(evalStr(`"${s}"`).value).toBe(s);
    });

    test("string of 33 chars (just past the buffer)", () => {
        const s = "x".repeat(33);
        expect(evalStr(`"${s}"`).value).toBe(s);
    });

    test("string of 64 chars", () => {
        const s = "x".repeat(64);
        expect(evalStr(`"${s}"`).value).toBe(s);
    });

    test("string of 100 chars", () => {
        const s = "x".repeat(100);
        expect(evalStr(`"${s}"`).value).toBe(s);
    });

    test("string of 1000 chars", () => {
        const s = "x".repeat(1000);
        expect(evalStr(`"${s}"`).value).toBe(s);
    });

    test("string of 10000 chars", () => {
        const s = "x".repeat(10000);
        expect(evalStr(`"${s}"`).value).toBe(s);
    });

    test("string with escape sequences longer than 32 chars", () => {
        const code = `return "tab\\there and newline\\nthere plus more chars to exceed thirty two"`;
        const r = runLua(code);
        expect(r.ok).toBe(true);
    });

    test("long identifier (name) longer than 32 chars", () => {
        const name = "a".repeat(60);
        const r = runLua(`local ${name} = 42; return ${name}`);
        expect(r.ok).toBe(true);
        expect(r.value).toBe("42");
    });

    test("long bracket string [[...]]", () => {
        const inner = "y".repeat(200);
        const r = runLua(`return [[${inner}]]`);
        expect(r.ok).toBe(true);
        expect(r.value).toBe(inner);
    });

    test("long error message is produced correctly (not a silent crash)", () => {
        const r = runLuaError(
            `error("this is a very long error message that exceeds thirty two characters and would crash the old lexer")`
        );
        expect(r.ok).toBe(true);
        expect(r.message).toContain("this is a very long error message");
    });

    test("comment longer than 32 chars", () => {
        const comment = "-- " + "c".repeat(100);
        const r = runLua(`${comment}\nreturn 1`);
        expect(r.ok).toBe(true);
        expect(r.value).toBe("1");
    });

    test("number literal with many digits parses as integer (no buffer crash)", () => {
        const r = runLua(`return 9223372036854775807`);
        expect(r.ok).toBe(true);
        expect(r.value).toBe("9223372036854775807");
    });

    test("concatenation producing long string at runtime", () => {
        const r = runLua(`return string.rep("ab", 100)`);
        expect(r.ok).toBe(true);
        expect(r.value.length).toBe(200);
    });
});

describe("collectgarbage (was: lua_gc not implemented)", () => {
    test("collectgarbage('collect') returns 0 and does not raise", () => {
        const r = runLua(`return collectgarbage("collect")`);
        expect(r.ok).toBe(true);
        expect(r.value).toBe("0");
    });

    test("collectgarbage('count') returns a number", () => {
        const r = runLua(`return collectgarbage("count")`);
        expect(r.ok).toBe(true);
        /* count returns KB as a float; stringifyValue uses tolstring which
           renders 0 as "0.0". Accept either form. */
        expect(["0", "0.0"]).toContain(r.value);
    });

    test("collectgarbage('isrunning') returns true", () => {
        const r = runLua(`return collectgarbage("isrunning")`);
        expect(r.ok).toBe(true);
        expect(r.value).toBe("true");
    });

    test("collectgarbage with default arg (collect) works", () => {
        const r = runLua(`return collectgarbage()`);
        expect(r.ok).toBe(true);
        expect(r.value).toBe("0");
    });
});
