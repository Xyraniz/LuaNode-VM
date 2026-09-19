"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { runLua } = require("./lua-helpers");

describe("Lua file I/O", () => {
    test("reads CRLF, long lines, and buffered bytes without dropping data", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "luanode-read-"));
        const filename = path.join(directory, "lines.txt");
        fs.writeFileSync(filename, `first\r\n${"x".repeat(9000)}\nlast`);
        const readSpy = jest.spyOn(fs, "readSync");
        try {
            const result = runLua(
                `local f=assert(io.open(${JSON.stringify(filename)}, 'rb')); ` +
                "local a=f:read('*l'); local b=f:read('*l'); " +
                "local c=f:read('*l'); local d=f:read('*l'); f:close(); " +
                "return a .. ':' .. tostring(#b) .. ':' .. c .. ':' .. tostring(d)"
            );
            expect(result.ok).toBe(true);
            expect(result.value).toBe("first:9000:last:nil");
            expect(readSpy.mock.calls.length).toBeLessThan(6);
        } finally {
            readSpy.mockRestore();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    test("seek discards cached input and resumes at the requested byte", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "luanode-seek-"));
        const filename = path.join(directory, "data.txt");
        fs.writeFileSync(filename, "abcdef");
        try {
            const result = runLua(
                `local f=assert(io.open(${JSON.stringify(filename)}, 'rb')); ` +
                "local a=f:read(1); f:seek('set', 3); " +
                "local b=f:read(2); f:close(); return a .. b"
            );
            expect(result.ok).toBe(true);
            expect(result.value).toBe("ade");
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    test("io.tmpfile uses a platform temporary directory", () => {
        const result = runLua(
            "local f=assert(io.tmpfile()); f:write('one\\ntwo'); f:seek('set'); " +
            "local line=f:read('*l'); local rest=f:read('*a'); " +
            "local ok=f:close(); return line .. ':' .. rest .. ':' .. tostring(ok)"
        );
        expect(result.ok).toBe(true);
        expect(result.value).toBe("one:two:true");
    });

    test("close still releases the descriptor when flushing fails", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "luanode-close-"));
        const filename = path.join(directory, "buffered.txt");
        const closeSpy = jest.spyOn(fs, "closeSync");
        const writeSpy = jest.spyOn(fs, "writeSync").mockImplementation(() => {
            throw new Error("simulated flush failure");
        });
        try {
            const result = runLua(
                `local f=assert(io.open(${JSON.stringify(filename)}, 'w')); ` +
                "f:setvbuf('full'); f:write('pending'); " +
                "local ok,msg=f:close(); return tostring(ok) .. ':' .. tostring(msg)"
            );
            expect(result.ok).toBe(true);
            expect(result.value).toMatch(/^nil:.*simulated flush failure/);
            expect(closeSpy).toHaveBeenCalled();
        } finally {
            writeSpy.mockRestore();
            closeSpy.mockRestore();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    test("io.tmpfile removes its directory when opening the file fails", () => {
        const directories = [];
        const originalMkdtemp = fs.mkdtempSync.bind(fs);
        const originalOpen = fs.openSync.bind(fs);
        const mkdtempSpy = jest.spyOn(fs, "mkdtempSync").mockImplementation((prefix) => {
            const directory = originalMkdtemp(prefix);
            directories.push(directory);
            return directory;
        });
        const openSpy = jest.spyOn(fs, "openSync").mockImplementation((filename, ...args) => {
            if (directories.some((directory) => filename === path.join(directory, "tmpfile")))
                throw new Error("simulated open failure");
            return originalOpen(filename, ...args);
        });
        try {
            const result = runLua("local file,msg=io.tmpfile(); return tostring(file) .. ':' .. tostring(msg)");
            expect(result.ok).toBe(true);
            expect(result.value).toMatch(/^nil:.*simulated open failure/);
            expect(directories).toHaveLength(1);
            expect(fs.existsSync(directories[0])).toBe(false);
        } finally {
            openSpy.mockRestore();
            mkdtempSpy.mockRestore();
            for (const directory of directories)
                fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
