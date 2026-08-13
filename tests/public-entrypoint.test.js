const canonical = require("../src/luanode.js");
const legacy = require("../src/fengari.js");

test("canonical entrypoint preserves the public C-shaped API", () => {
    expect(canonical.lua).toBe(legacy.lua);
    expect(canonical.lauxlib).toBe(legacy.lauxlib);
    expect(canonical.lualib).toBe(legacy.lualib);
});
