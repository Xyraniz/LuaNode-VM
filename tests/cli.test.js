"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

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
});
