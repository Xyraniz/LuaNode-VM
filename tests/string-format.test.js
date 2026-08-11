"use strict";

/*
** Tests for string.format with 64-bit integer values.
** The original Fengari used sprintf-js which cannot handle BigInt,
** producing wrong output for large integers. LuaNode-VM implements
** its own integer formatter supporting the full int64 range.
*/

const { evalStr } = require("./lua-helpers");

describe("string.format with %d and large integers", () => {
    test("%d with maxinteger", () => {
        expect(evalStr("string.format('%d', 9223372036854775807)").value).toBe("9223372036854775807");
    });

    test("%d with negative large integer", () => {
        expect(evalStr("string.format('%d', -9223372036854775807)").value).toBe("-9223372036854775807");
    });

    test("%d with 2^53+1 (the value Fengari lost)", () => {
        expect(evalStr("string.format('%d', 9007199254740993)").value).toBe("9007199254740993");
    });

    test("%d with small integer", () => {
        expect(evalStr("string.format('%d', 42)").value).toBe("42");
    });

    test("%d with zero", () => {
        expect(evalStr("string.format('%d', 0)").value).toBe("0");
    });

    test("%i is equivalent to %d", () => {
        expect(evalStr("string.format('%i', 9223372036854775807)").value).toBe("9223372036854775807");
    });
});

describe("string.format with %x and %X (hexadecimal)", () => {
    test("%x with large hex value", () => {
        expect(evalStr("string.format('%x', 0x123456789ABCDEF)").value).toBe("123456789abcdef");
    });

    test("%X with large hex value (uppercase)", () => {
        expect(evalStr("string.format('%X', 0x123456789ABCDEF)").value).toBe("123456789ABCDEF");
    });

    test("%x with maxinteger", () => {
        expect(evalStr("string.format('%x', 9223372036854775807)").value).toBe("7fffffffffffffff");
    });

    test("%x with zero", () => {
        expect(evalStr("string.format('%x', 0)").value).toBe("0");
    });

    test("%#x with alt form prefix", () => {
        expect(evalStr("string.format('%#x', 255)").value).toBe("0xff");
    });

    test("%#X with alt form prefix (uppercase)", () => {
        expect(evalStr("string.format('%#X', 255)").value).toBe("0XFF");
    });

    test("%x of -1 gives all f's (unsigned interpretation)", () => {
        expect(evalStr("string.format('%x', -1)").value).toBe("ffffffffffffffff");
    });
});

describe("string.format with %u (unsigned)", () => {
    test("%u with -1 gives 2^64-1", () => {
        expect(evalStr("string.format('%u', -1)").value).toBe("18446744073709551615");
    });

    test("%u with maxinteger", () => {
        expect(evalStr("string.format('%u', 9223372036854775807)").value).toBe("9223372036854775807");
    });
});

describe("string.format with %o (octal)", () => {
    test("%o with zero", () => {
        expect(evalStr("string.format('%o', 0)").value).toBe("0");
    });

    test("%o with 8", () => {
        expect(evalStr("string.format('%o', 8)").value).toBe("10");
    });

    test("%o with 64", () => {
        expect(evalStr("string.format('%o', 64)").value).toBe("100");
    });
});

describe("string.format with width and flags", () => {
    test("%5d right-aligned", () => {
        expect(evalStr("string.format('%5d', 42)").value).toBe("   42");
    });

    test("%-5d left-aligned", () => {
        expect(evalStr("string.format('%-5d|', 42)").value).toBe("42   |");
    });

    test("%+d with plus sign", () => {
        expect(evalStr("string.format('%+d', 42)").value).toBe("+42");
    });

    test("%08d zero-padded", () => {
        expect(evalStr("string.format('%08d', 42)").value).toBe("00000042");
    });

    test("%5x right-aligned hex", () => {
        expect(evalStr("string.format('%5x', 255)").value).toBe("   ff");
    });

    test("Width with large integer", () => {
        expect(evalStr("string.format('%25d', 9223372036854775807)").value).toBe("      9223372036854775807");
    });
});

describe("string.format with %c (character)", () => {
    test("%c with 65 gives 'A'", () => {
        expect(evalStr("string.format('%c', 65)").value).toBe("A");
    });

    test("%c with 97 gives 'a'", () => {
        expect(evalStr("string.format('%c', 97)").value).toBe("a");
    });
});

describe("string.format with floats", () => {
    test("%f with float", () => {
        const r = evalStr("string.format('%.2f', 3.14159)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("3.14");
    });

    test("%e scientific notation", () => {
        const r = evalStr("string.format('%.1e', 1234.5)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("1.2e+03");
    });
});

describe("string.format with %q (quoted)", () => {
    test("%q with integer", () => {
        const r = evalStr("string.format('%q', 42)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("42");
    });

    test("%q with large integer", () => {
        const r = evalStr("string.format('%q', 9223372036854775807)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("9223372036854775807");
    });

    test("%q with mininteger (uses hex form)", () => {
        const r = evalStr("string.format('%q', math.mininteger)");
        expect(r.ok).toBe(true);
        expect(r.value).toBe("0x8000000000000000");
    });
});
