"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const F = require("../src/fengari.js");

describe("LuaNode-VM CLI", () => {
    test("preserves the invoked script path in arg[0]", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luanode-cli-"));
        const script = path.join(dir, "print-arg0.lua");
        const cli = path.join(__dirname, "..", "cli", "luanode.js");
        fs.writeFileSync(script, "print(arg[0])\n", "utf8");

        try {
            const result = spawnSync(process.execPath, [cli, script], { encoding: "utf8" });
            expect(result.status).toBe(0);
            expect(result.stderr).toBe("");
            expect(result.stdout.trim()).toBe(script);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test("loads binary chunks without decoding them as UTF-8", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luanode-bytecode-"));
        const script = path.join(dir, "print-bytecode.luac");
        const cli = path.join(__dirname, "..", "cli", "luanode.js");
        const L = F.lauxlib.luaL_newstate();
        const chunks = [];

        try {
            expect(F.lauxlib.luaL_loadstring(L, F.to_luastring("print('bytecode-ok')")))
                .toBe(F.lua.LUA_OK);
            const dumpStatus = F.lua.lua_dump(L, (_state, bytes, size) => {
                chunks.push(Buffer.from(bytes.subarray(0, size)));
                return 0;
            }, null, 0);
            expect(dumpStatus).toBe(0);
            fs.writeFileSync(script, Buffer.concat(chunks));

            const result = spawnSync(process.execPath, [cli, script], { encoding: "utf8" });
            expect(result.status).toBe(0);
            expect(result.stderr).toBe("");
            expect(result.stdout.trim()).toBe("bytecode-ok");
        } finally {
            F.lua.lua_close(L);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
