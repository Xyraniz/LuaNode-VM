"use strict";

/*
** Tests for true 64-bit integer support in LuaNode-VM.
** These tests verify that the BigInt-backed hybrid representation
** correctly implements Lua 5.3's 64-bit integer semantics, which the
** original Fengari could NOT do (it used Number, limited to 2^53-1).
*/

const { evalStr, runLua, runLuaError } = require("./lua-helpers");

describe("64-bit integer limits", () => {
    test("math.maxinteger is the real 2^63-1", () => {
        const r = evalStr("tostring(math.maxinteger)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("9223372036854775807");
    });

    test("math.mininteger is the real -2^63", () => {
        const r = evalStr("tostring(math.mininteger)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("-9223372036854775808");
    });

    test("MAXINTEGER is an integer, not a float", () => {
        const r = runLua("return math.type(math.maxinteger)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("integer");
    });

    test("MININTEGER is an integer, not a float", () => {
        const r = runLua("return math.type(math.mininteger)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("integer");
    });
});

describe("Large integer literals", () => {
    test("9223372036854775807 parses exactly as integer", () => {
        const r = evalStr("tostring(9223372036854775807)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("9223372036854775807");
    });

    test("9007199254740993 (2^53+1) parses exactly — the value Fengari lost", () => {
        const r = evalStr("tostring(9007199254740993)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("9007199254740993");
    });

    test("9007199254740992 + 1 = 9007199254740993 (no precision loss)", () => {
        const r = evalStr("tostring(9007199254740992 + 1)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("9007199254740993");
    });

    test("Hex literal 0x7FFFFFFFFFFFFFFF parses as maxinteger", () => {
        const r = evalStr("tostring(0x7FFFFFFFFFFFFFFF)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("9223372036854775807");
    });

    test("Large hex literal 0x123456789ABCDEF", () => {
        const r = evalStr("tostring(0x123456789ABCDEF)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("81985529216486895");
    });

    test("Negative large integer literal", () => {
        const r = evalStr("tostring(-9223372036854775807)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("-9223372036854775807");
    });
});

describe("Overflow wraparound (two's complement)", () => {
    test("maxinteger + 1 wraps to mininteger", () => {
        const r = evalStr("tostring(math.maxinteger + 1)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("-9223372036854775808");
    });

    test("mininteger - 1 wraps to maxinteger", () => {
        const r = evalStr("tostring(math.mininteger - 1)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("9223372036854775807");
    });

    test("maxinteger + 2 wraps correctly", () => {
        const r = evalStr("tostring(math.maxinteger + 2)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("-9223372036854775807");
    });

    test("mininteger * -1 wraps to mininteger (two's complement quirk)", () => {
        const r = evalStr("tostring(math.mininteger * -1)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("-9223372036854775808");
    });

    test("Overflow in multiplication wraps around", () => {
        // 3037000500^2 = 9223372037000250000, mod 2^64 = -9223372036709301616
        const r = evalStr("tostring(3037000500 * 3037000500)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("-9223372036709301616");
    });
});

describe("Integer division and modulo (Lua 5.3 semantics)", () => {
    test("Floor division: 7 // 2 = 3", () => {
        expect(evalStr("tostring(7 // 2)").value).toBe("3");
    });

    test("Floor division: -7 // 2 = -4 (floor, not truncate)", () => {
        expect(evalStr("tostring(-7 // 2)").value).toBe("-4");
    });

    test("Floor division: 7 // -2 = -4", () => {
        expect(evalStr("tostring(7 // -2)").value).toBe("-4");
    });

    test("Modulo: 7 % 3 = 1", () => {
        expect(evalStr("tostring(7 % 3)").value).toBe("1");
    });

    test("Modulo: -7 % 3 = 2 (remainder takes divisor sign)", () => {
        expect(evalStr("tostring(-7 % 3)").value).toBe("2");
    });

    test("Modulo: 7 % -3 = -2", () => {
        expect(evalStr("tostring(7 % -3)").value).toBe("-2");
    });

    test("Division by zero raises error", () => {
        const r = runLuaError("return 1 // 0");
        expect(r.ok).toBe(true);
        expect(r.message).toMatch(/divide by zero|division/);
    });

    test("Modulo by zero raises error", () => {
        const r = runLuaError("return 1 % 0");
        expect(r.ok).toBe(true);
        expect(r.message).toMatch(/n%0|modulo/);
    });

    test("mininteger // -1 returns mininteger (Lua 5.3 semantics)", () => {
        const r = evalStr("tostring(math.mininteger // -1)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("-9223372036854775808");
    });

    test("mininteger % -1 = 0 (no overflow)", () => {
        const r = evalStr("tostring(math.mininteger % -1)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("0");
    });
});

describe("64-bit bitwise operations", () => {
    test("AND with 0 gives 0", () => {
        expect(evalStr("tostring(0x7FFFFFFFFFFFFFFF & 0)").value).toBe("0");
    });

    test("OR with 0 gives identity", () => {
        expect(evalStr("tostring(0x7FFFFFFFFFFFFFFF | 0)").value).toBe("9223372036854775807");
    });

    test("XOR with 0 gives identity", () => {
        expect(evalStr("tostring(0x7FFFFFFFFFFFFFFF ~ 0)").value).toBe("9223372036854775807");
    });

    test("NOT of 0 gives -1", () => {
        expect(evalStr("tostring(~0)").value).toBe("-1");
    });

    test("Left shift by 63", () => {
        expect(evalStr("tostring(1 << 63)").value).toBe("-9223372036854775808");
    });

    test("Logical right shift of -1 gives maxinteger", () => {
        expect(evalStr("tostring(-1 >> 1)").value).toBe("9223372036854775807");
    });

    test("Left shift by 62", () => {
        expect(evalStr("tostring(1 << 62)").value).toBe("4611686018427387904");
    });

    test("Negative shift count reverses direction", () => {
        expect(evalStr("tostring(256 >> -4)").value).toBe("4096");
        expect(evalStr("tostring(256 << -4)").value).toBe("16");
    });
});

describe("Integer comparison and equality", () => {
    test("Large integers compare correctly", () => {
        expect(evalStr("tostring(9007199254740993 < 9007199254740994)").value).toBe("true");
        expect(evalStr("tostring(9007199254740993 <= 9007199254740993)").value).toBe("true");
    });

    test("Large integer equality", () => {
        expect(evalStr("tostring(9007199254740993 == 9007199254740993)").value).toBe("true");
        expect(evalStr("tostring(9007199254740993 ~= 9007199254740994)").value).toBe("true");
    });

    test("maxinteger > maxinteger - 1", () => {
        expect(evalStr("tostring(math.maxinteger > math.maxinteger - 1)").value).toBe("true");
    });
});

describe("For loops with large integer ranges", () => {
    test("Counting in the 2^53 range", () => {
        const r = runLua("local s = 0; for i = 9007199254740990, 9007199254741000 do s = s + 1 end; return tostring(s)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("11");
    });

    test("For loop with negative step in large range", () => {
        const r = runLua("local s = 0; for i = 9007199254741000, 9007199254740990, -1 do s = s + 1 end; return tostring(s)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("11");
    });
});

describe("math library with 64-bit integers", () => {
    test("math.abs of large negative", () => {
        expect(evalStr("tostring(math.abs(-9223372036854775807))").value).toBe("9223372036854775807");
    });

    test("math.abs(mininteger) wraps (Lua 5.3 behavior)", () => {
        expect(evalStr("tostring(math.abs(math.mininteger))").value).toBe("-9223372036854775808");
    });

    test("math.ult unsigned comparison", () => {
        expect(evalStr("tostring(math.ult(1, 2))").value).toBe("true");
        expect(evalStr("tostring(math.ult(-1, 1))").value).toBe("false");
        expect(evalStr("tostring(math.ult(1, -1))").value).toBe("true");
    });

    test("math.type returns 'integer' for large ints", () => {
        expect(evalStr("math.type(9223372036854775807)").value).toBe("integer");
    });

    test("math.type returns 'float' for overflow literals", () => {
        expect(evalStr("math.type(9223372036854775808)").value).toBe("float");
    });

    test("math.tointeger converts float to int when integral", () => {
        expect(evalStr("tostring(math.tointeger(3.0))").value).toBe("3");
    });

    test("math.tointeger returns nil for non-integral float", () => {
        expect(evalStr("tostring(math.tointeger(3.5))").value).toBe("nil");
    });
});
