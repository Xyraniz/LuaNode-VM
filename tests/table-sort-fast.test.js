const { runLua } = require("./lua-helpers");

const run = (source) => {
    const result = runLua(source);
    expect(result.ok).toBe(true);
    return result.value;
};

describe("table.sort numeric fast path", () => {
    test("sorts dense integer arrays", () => {
        expect(run("local t = {5, 1, 4, 2, 3}; table.sort(t); return table.concat(t, ',' )"))
            .toBe("1,2,3,4,5");
    });

    test("keeps large int64 ordering exact", () => {
        expect(run("local t = {9007199254740993, 9007199254740991, 9223372036854775807}; table.sort(t); return table.concat(t, ',')"))
            .toBe("9007199254740991,9007199254740993,9223372036854775807");
    });

    test("sorts mixed numeric values using Lua numeric semantics", () => {
        expect(run("local t = {3.5, 1, 2.25, 2}; table.sort(t); return table.concat(t, ',')"))
            .toBe("1,2,2.25,3.5");
    });

    test("preserves custom comparator semantics", () => {
        expect(run(
            "local calls = 0; " +
            "local function greater(a, b) calls = calls + 1; return a > b end; " +
            "local t = {1, 5, 2, 4, 3}; " +
            "table.sort(t, greater); " +
            "return tostring(calls > 0) .. ':' .. table.concat(t, ',')"
        )).toBe("true:5,4,3,2,1");
    });
});
