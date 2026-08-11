"use strict";

/*
** Regression tests for general Lua 5.3 functionality.
** Ensures the 64-bit integer overhaul didn't break basic features:
** strings, coroutines, closures, metatables, math, control flow.
*/

const { evalStr, runLua, runLuaError } = require("./lua-helpers");

describe("String library", () => {
    test("string.sub", () => {
        expect(evalStr("string.sub('hello world', 1, 5)").value).toBe("hello");
        expect(evalStr("string.sub('hello world', 7)").value).toBe("world");
        expect(evalStr("string.sub('hello', -3)").value).toBe("llo");
    });

    test("string.rep", () => {
        expect(evalStr("string.rep('ab', 3)").value).toBe("ababab");
        expect(evalStr("string.rep('x', 0)").value).toBe("");
        expect(evalStr("string.rep('ab', 2, '-')").value).toBe("ab-ab");
    });

    test("string.find and string.match", () => {
        expect(evalStr("string.find('hello', 'll')").value).toBe("3\t4");
        expect(evalStr("string.match('date: 2024', '%d+')").value).toBe("2024");
    });

    test("string.gsub", () => {
        expect(evalStr("string.gsub('hello', 'l', 'L')").value).toBe("heLLo\t2");
    });

    test("string.format basic %s and %d", () => {
        expect(evalStr("string.format('%s = %d', 'x', 42)").value).toBe("x = 42");
    });

    test("string.format %f", () => {
        expect(evalStr("string.format('%.2f', 3.14159)").value).toBe("3.14");
    });

    test("string.format %x", () => {
        expect(evalStr("string.format('%x', 255)").value).toBe("ff");
        expect(evalStr("string.format('%X', 255)").value).toBe("FF");
    });

    test("string.format %o", () => {
        expect(evalStr("string.format('%o', 8)").value).toBe("10");
    });

    test("string.upper and string.lower", () => {
        expect(evalStr("string.upper('hello')").value).toBe("HELLO");
        expect(evalStr("string.lower('HELLO')").value).toBe("hello");
    });

    test("string.len and # operator", () => {
        expect(evalStr("string.len('hello')").value).toBe("5");
        expect(evalStr("#'hello'").value).toBe("5");
    });

    test("string.byte and string.char", () => {
        expect(evalStr("string.byte('A')").value).toBe("65");
        expect(evalStr("string.char(65, 66, 67)").value).toBe("ABC");
    });

    test("string.reverse", () => {
        expect(evalStr("string.reverse('hello')").value).toBe("olleh");
    });
});

describe("Math library", () => {
    test("basic arithmetic functions", () => {
        expect(evalStr("math.abs(-5)").value).toBe("5");
        expect(evalStr("math.max(3, 7, 1)").value).toBe("7");
        expect(evalStr("math.min(3, 7, 1)").value).toBe("1");
        expect(evalStr("math.floor(3.7)").value).toBe("3");
        expect(evalStr("math.ceil(3.2)").value).toBe("4");
    });

    test("math.sqrt and math.pi", () => {
        expect(evalStr("tostring(math.sqrt(16))").value).toBe("4.0");
    });

    test("math.type", () => {
        expect(evalStr("math.type(42)").value).toBe("integer");
        expect(evalStr("math.type(3.14)").value).toBe("float");
        expect(evalStr("math.type('x')").value).toBe("nil");
    });

    test("math.tointeger", () => {
        expect(evalStr("tostring(math.tointeger(3.0))").value).toBe("3");
        expect(evalStr("tostring(math.tointeger(3.5))").value).toBe("nil");
    });

    test("math.maxinteger and math.mininteger", () => {
        expect(evalStr("tostring(math.maxinteger)").value).toBe("9223372036854775807");
        expect(evalStr("tostring(math.mininteger)").value).toBe("-9223372036854775808");
    });

    test("math.fmod with integers", () => {
        expect(evalStr("tostring(math.fmod(7, 3))").value).toBe("1");
    });
});

describe("Coroutines", () => {
    test("basic coroutine.yield and resume", () => {
        const r = runLua(
            "local co = coroutine.create(function(a, b) " +
            "coroutine.yield(a + b) " +
            "coroutine.yield(a * b) " +
            "end); " +
            "local _, r1 = coroutine.resume(co, 3, 4); " +
            "local _, r2 = coroutine.resume(co); " +
            "return tostring(r1) .. ',' .. tostring(r2)"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("7,12");
    });

    test("coroutine.status", () => {
        const r = runLua(
            "local co = coroutine.create(function() coroutine.yield() end); " +
            "local s0 = coroutine.status(co); " +
            "coroutine.resume(co); " +
            "local s1 = coroutine.status(co); " +
            "coroutine.resume(co); " +
            "local s2 = coroutine.status(co); " +
            "return s0 .. ',' .. s1 .. ',' .. s2"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("suspended,suspended,dead");
    });

    test("coroutine.wrap", () => {
        const r = runLua(
            "local f = coroutine.wrap(function() " +
            "coroutine.yield(1) " +
            "coroutine.yield(2) " +
            "coroutine.yield(3) " +
            "end); " +
            "return tostring(f()) .. tostring(f()) .. tostring(f())"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("123");
    });
});

describe("Closures and scoping", () => {
    test("closure captures upvalue", () => {
        const r = runLua(
            "local function counter() " +
            "local n = 0; " +
            "return function() n = n + 1; return n end " +
            "end; " +
            "local c = counter(); " +
            "return tostring(c()) .. tostring(c()) .. tostring(c())"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("123");
    });

    test("multiple closures share upvalue", () => {
        const r = runLua(
            "local function pair() " +
            "local x = 0; " +
            "local function get() return x end " +
            "local function set(v) x = v end " +
            "return get, set " +
            "end; " +
            "local g, s = pair(); " +
            "s(42); " +
            "return tostring(g())"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("42");
    });

    test("recursive function (local with name)", () => {
        const r = runLua(
            "local function fact(n) " +
            "if n <= 1 then return 1 end " +
            "return n * fact(n - 1) " +
            "end; " +
            "return tostring(fact(5))"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("120");
    });
});

describe("Metatables", () => {
    test("__add metamethod", () => {
        const r = runLua(
            "local mt = {__add = function(a, b) return setmetatable({v = a.v + b.v}, mt) end}; " +
            "local function vec(v) return setmetatable({v = v}, mt) end; " +
            "local r = vec(3) + vec(4); " +
            "return tostring(r.v)"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("7");
    });

    test("__index metamethod (function)", () => {
        const r = runLua(
            "local t = setmetatable({}, {__index = function(_, k) return 'default:' .. k end}); " +
            "return t.missing"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("default:missing");
    });

    test("__index metamethod (table)", () => {
        const r = runLua(
            "local proto = {greet = function() return 'hello' end}; " +
            "local t = setmetatable({}, {__index = proto}); " +
            "return t.greet()"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("hello");
    });

    test("__tostring metamethod", () => {
        const r = runLua(
            "local t = setmetatable({}, {__tostring = function() return 'custom!' end}); " +
            "return tostring(t)"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("custom!");
    });

    test("__eq metamethod", () => {
        const r = runLua(
            "local mt = {__eq = function(a, b) return a.id == b.id end}; " +
            "local a = setmetatable({id = 1}, mt); " +
            "local b = setmetatable({id = 1}, mt); " +
            "local c = setmetatable({id = 2}, mt); " +
            "return tostring(a == b) .. ',' .. tostring(a == c)"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("true,false");
    });
});

describe("Control flow", () => {
    test("if/elseif/else", () => {
        const r = runLua(
            "local function classify(n) " +
            "if n < 0 then return 'neg' " +
            "elseif n == 0 then return 'zero' " +
            "else return 'pos' end " +
            "end; " +
            "return classify(-5) .. classify(0) .. classify(5)"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("negzeropos");
    });

    test("while loop", () => {
        const r = runLua(
            "local i = 1; local s = 0; " +
            "while i <= 10 do s = s + i; i = i + 1 end; " +
            "return tostring(s)"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("55");
    });

    test("repeat/until", () => {
        const r = runLua(
            "local i = 0; local s = 0; " +
            "repeat i = i + 1; s = s + i until i >= 5; " +
            "return tostring(s)"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("15");
    });

    test("numeric for with step", () => {
        const r = runLua(
            "local s = 0; " +
            "for i = 10, 1, -2 do s = s + i end; " +
            "return tostring(s)"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("30");
    });

    test("break", () => {
        const r = runLua(
            "local s = 0; " +
            "for i = 1, 100 do " +
            "if i > 5 then break end; " +
            "s = s + i " +
            "end; " +
            "return tostring(s)"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("15");
    });

    test("pcall catches errors", () => {
        const r = runLua(
            "local ok, err = pcall(function() error('boom!') end); " +
            "return tostring(ok) .. ':' .. tostring(err)"
        );
        expect(r.ok).toBe(true);
        /* The error message includes the chunk name prefix; just check the tail */
        expect(r.value).toMatch(/false:.*boom!/);
    });
});

describe("Integer/float interactions", () => {
    test("integer division //", () => {
        expect(evalStr("tostring(7 // 2)").value).toBe("3");
        expect(evalStr("tostring(-7 // 2)").value).toBe("-4");
        expect(evalStr("tostring(7.5 // 2)").value).toBe("3.0");
    });

    test("modulo %", () => {
        expect(evalStr("tostring(7 % 3)").value).toBe("1");
        expect(evalStr("tostring(-7 % 3)").value).toBe("2");
        expect(evalStr("tostring(7 % -3)").value).toBe("-2");
    });

    test("integer + float = float", () => {
        expect(evalStr("math.type(3 + 0.0)").value).toBe("float");
    });

    test("float floor division returns float", () => {
        expect(evalStr("math.type(3.0 // 1)").value).toBe("float");
    });

    test("bitwise operations", () => {
        expect(evalStr("tostring(0xFF & 0x0F)").value).toBe("15");
        expect(evalStr("tostring(0xF0 | 0x0F)").value).toBe("255");
        expect(evalStr("tostring(0xFF ~ 0x0F)").value).toBe("240");
        expect(evalStr("tostring(~0)").value).toBe("-1");
        expect(evalStr("tostring(1 << 4)").value).toBe("16");
        expect(evalStr("tostring(256 >> 4)").value).toBe("16");
    });

    test("floor division overflow MIN_INT / -1", () => {
        const r = runLua(
            "local ok, err = pcall(function() return math.mininteger // -1 end);" +
            "return tostring(ok)"
        );
        expect(r.ok).toBe(true);
        expect(r.value).toBe("false");
    });
});
