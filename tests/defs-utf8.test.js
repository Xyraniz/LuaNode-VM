"use strict";

const { to_jsstring } = require("../src/defs.js");

describe("Lua byte strings converted to JavaScript strings", () => {
    test("valid non-BMP UTF-8 decodes to its scalar value", () => {
        expect(to_jsstring(Uint8Array.from([0xF0, 0x9F, 0x8C, 0x8B])))
            .toBe("🌋");
    });

    test("replacement mode emits U+FFFD and preserves following ASCII", () => {
        const invalid = Uint8Array.from([0xE2, 0x28, 0xA1, 0x41]);
        expect(to_jsstring(invalid, 0, invalid.length, true)).toBe("\uFFFD(\uFFFDA");
        expect(() => to_jsstring(invalid)).toThrow(RangeError);
    });

    test.each([
        [0xE0, 0x80, 0x80],       // overlong encoding
        [0xED, 0xA0, 0x80],       // UTF-16 surrogate
        [0xF4, 0x90, 0x80, 0x80] // above U+10FFFF
    ])("rejects invalid Unicode scalar encodings %#", (...bytes) => {
        expect(() => to_jsstring(Uint8Array.from(bytes))).toThrow(RangeError);
        expect(to_jsstring(Uint8Array.from(bytes), 0, bytes.length, true))
            .toBe("\uFFFD".repeat(bytes.length));
    });

    test("replaces one truncated multibyte suffix once", () => {
        const invalid = Uint8Array.from([0xE2, 0x82]);
        expect(to_jsstring(invalid, 0, invalid.length, true)).toBe("\uFFFD");
    });
});
