"use strict";

const fs      = require('fs');

const {
    LUA_REGISTRYINDEX,
    LUA_TNUMBER,
    lua_getfield,
    lua_gettop,
    lua_insert,
    lua_isinteger,
    lua_isnone,
    lua_isnoneornil,
    lua_newuserdata,
    lua_pop,
    lua_pushcclosure,
    lua_pushinteger,
    lua_pushlightuserdata,
    lua_pushliteral,
    lua_pushlstring,
    lua_pushnil,
    lua_pushnumber,
    lua_pushstring,
    lua_pushvalue,
    lua_remove,
    lua_setfield,
    lua_settop,
    lua_tointeger,
    lua_tonumber,
    lua_tostring,
    lua_type,
    lua_touserdata,
    lua_upvalueindex
} = require('../lua.js');
const {
    LUA_FILEHANDLE,
    luaL_argcheck,
    luaL_checkany,
    luaL_checkinteger,
    luaL_checklstring,
    luaL_checkoption,
    luaL_checkudata,
    luaL_error,
    luaL_fileresult,
    luaL_newlib,
    luaL_newmetatable,
    luaL_optinteger,
    luaL_setfuncs,
    luaL_setmetatable,
    luaL_testudata
} = require('../lauxlib.js');
const lualib = require('./lualib.js');
const { to_jsstring, to_luastring } = require("../fengaricore.js");
const I64 = require('../vm/lint64.js');

const IO_PREFIX = "_IO_";
const IOPREF_LEN = IO_PREFIX.length;
const IO_INPUT = to_luastring(IO_PREFIX + "input");
const IO_OUTPUT = to_luastring(IO_PREFIX + "output");

const tolstream = function(L) {
    return luaL_checkudata(L, 1, LUA_FILEHANDLE);
};

const isclosed = function(p) {
    return p.closef === null;
};

const io_type = function(L) {
    luaL_checkany(L, 1);
    let p = luaL_testudata(L, 1, LUA_FILEHANDLE);
    if (p === null)
        lua_pushnil(L);  /* not a file */
    else if (isclosed(p))
        lua_pushliteral(L, "closed file");
    else
        lua_pushliteral(L, "file");
    return 1;
};

const f_tostring = function(L) {
    let p = tolstream(L);
    if (isclosed(p))
        lua_pushliteral(L, "file (closed)");
    else
        lua_pushstring(L, to_luastring(`file (${p.f.toString()})`));
    return 1;
};

const tofile = function(L) {
    let p = tolstream(L);
    if (isclosed(p))
        luaL_error(L, to_luastring("attempt to use a closed file"));
    lualib.lua_assert(p.f);
    return p.f;
};

const newprefile = function(L) {
    let p = lua_newuserdata(L);
    p.f = null;
    p.closef = null;
    luaL_setmetatable(L, LUA_FILEHANDLE);
    return p;
};

const close_file = function(p) {
    if (!p || p.closef === null) return false;
    const f = p.f;
    try {
        if (f) flush_buffer(f);
        if (f && typeof f.fd === "number" && f.fd >= 0)
            fs.closeSync(f.fd);
    } finally {
        if (f && f.temporary && f.path) {
            try { fs.unlinkSync(f.path); } catch (e) {}
            if (f.directory) try { fs.rmdirSync(f.directory); } catch (e) {}
        }
        p.closef = null;
        p.f = null;
    }
    return true;
};

const f_close = function(L) {
    const p = tolstream(L);
    if (isclosed(p))
        return luaL_error(L, to_luastring("file is already closed"));
    if (p.closef === io_noclose)
        return io_noclose(L);
    close_file(p);
    return luaL_fileresult(L, true, null, null);
};

const f_gc = function(L) {
    const p = tolstream(L);
    if (!isclosed(p)) close_file(p);
    return 0;
};

const flush_buffer = function(f) {
    if (!f || !f.buffer || f.buffer.length === 0) return true;
    const data = Buffer.concat(f.buffer);
    const position = f.append ? null : (f.positionable ? f.position : null);
    const written = fs.writeSync(f.fd, data, 0, data.length, position);
    if (written !== data.length) throw new Error("short write");
    if (f.positionable) {
        if (f.append) f.position = fs.fstatSync(f.fd).size;
        else f.position += written;
    }
    f.buffer = [];
    f.bufferLength = 0;
    return true;
};

const write_file_data = function(f, data) {
    if (!f.bufferMode || f.bufferMode === "no") {
        const position = f.append ? null : (f.positionable ? f.position : null);
        const written = fs.writeSync(f.fd, data, 0, data.length, position);
        if (f.positionable) {
            if (f.append) f.position = fs.fstatSync(f.fd).size;
            else f.position += written;
        }
        return written === data.length;
    }
    f.buffer.push(Buffer.from(data));
    f.bufferLength += data.length;
    if (f.bufferMode === "line" && data.includes(10)) flush_buffer(f);
    else if (f.bufferMode === "full" && f.bufferLength >= f.bufferSize) flush_buffer(f);
    return true;
};

const mode_to_flags = function(mode) {
    const base = mode[0];
    const plus = mode.indexOf("+") >= 0;
    if (base === "r") return plus ? "r+" : "r";
    if (base === "w") return plus ? "w+" : "w";
    return plus ? "a+" : "a";
};

const check_mode = function(L, mode, arg) {
    const valid = /^[rwa]\+?b*$/.test(mode);
    luaL_argcheck(L, valid, arg, to_luastring("invalid mode", true));
};

const io_open = function(L) {
    const filename = luaL_checklstring(L, 1);
    const modeBytes = lua_isnoneornil(L, 2) ? to_luastring("r", true) : luaL_checklstring(L, 2);
    const mode = to_jsstring(modeBytes);
    check_mode(L, mode, 2);
    const p = newprefile(L);
    try {
        const fd = fs.openSync(to_jsstring(filename), mode_to_flags(mode));
        const stat = fs.fstatSync(fd);
        p.f = {
            fd,
            position: mode[0] === "a" ? stat.size : 0,
            positionable: true,
            append: mode[0] === "a",
            bufferMode: "no",
            bufferSize: 8192,
            buffer: [],
            bufferLength: 0
        };
        p.closef = f_close;
        return 1;
    } catch (e) {
        p.closef = null;
        p.f = null;
        return luaL_fileresult(L, false, filename, e);
    }
};

const read_bytes = function(f, count) {
    if (count <= 0) return new Uint8Array(0);
    const out = Buffer.alloc(count);
    let got = 0;
    while (got < count) {
        const n = fs.readSync(f.fd, out, got, count - got, f.positionable ? f.position : null);
        if (n === 0) break;
        got += n;
        if (f.positionable) f.position += n;
    }
    return new Uint8Array(out.buffer, out.byteOffset, got);
};

const read_ahead = function(f) {
    if (f.positionable) {
        const size = fs.fstatSync(f.fd).size;
        const remain = Math.max(0, size - f.position);
        const position = f.position;
        const data = read_bytes(f, remain);
        f.position = position;
        return data;
    }
    const chunks = [];
    for (;;) {
        const chunk = Buffer.alloc(4096);
        const n = fs.readSync(f.fd, chunk, 0, chunk.length, null);
        if (n === 0) break;
        chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, n));
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
};

const read_line = function(f, keepNewline) {
    const bytes = [];
    for (;;) {
        const b = read_bytes(f, 1);
        if (b.length === 0) break;
        bytes.push(b[0]);
        if (b[0] === 10) break;
    }
    if (bytes.length === 0) return null;
    if (!keepNewline && bytes[bytes.length - 1] === 10) bytes.pop();
    if (!keepNewline && bytes.length && bytes[bytes.length - 1] === 13) bytes.pop();
    return Uint8Array.from(bytes);
};

const number_prefix_length = function(text) {
    let i = 0;
    while (i < text.length && "\t\v\f \n\r".indexOf(text[i]) >= 0) i++;
    if (text[i] === "+" || text[i] === "-") i++;
    let count = 0;
    let hex = false;
    if (text[i] === "0") {
        i++;
        count = 1;
        if (text[i] === "x" || text[i] === "X") {
            i++;
            hex = true;
            count = 0;
        }
    }
    const isDigit = (c) => hex ? /^[0-9A-Fa-f]$/.test(c) : /^[0-9]$/.test(c);
    while (i < text.length && isDigit(text[i])) { i++; count++; }
    if (text[i] === ".") {
        i++;
        while (i < text.length && isDigit(text[i])) { i++; count++; }
    }
    const exponent = hex ? (text[i] === "p" || text[i] === "P") : (text[i] === "e" || text[i] === "E");
    if (count > 0 && exponent) {
        i++;
        if (text[i] === "+" || text[i] === "-") i++;
        while (i < text.length && /^[0-9]$/.test(text[i])) i++;
    }
    return i;
};

const read_number = function(L, f) {
    const ahead = read_ahead(f);
    const text = Buffer.from(ahead).toString("utf8");
    const numberPattern = /^[\t\v\f \n\r]*([+-]?(?:0[xX](?:[0-9A-Fa-f]+(?:\.[0-9A-Fa-f]*)?|\.[0-9A-Fa-f]+)(?:[pP][+-]?\d*)?|(?!0[xX])(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d*)?))/;
    const match = numberPattern.exec(text);
    if (!match) {
        /* Lua consumes the malformed numeric prefix before reporting failure. */
        const consumed = number_prefix_length(text);
        if (f.positionable) f.position += consumed;
        lua_pushnil(L);
        return false;
    }
    const consumed = Buffer.byteLength(match[0]);
    if (consumed > 200) {
        if (f.positionable) f.position += 200;
        lua_pushnil(L);
        return false;
    }
    if (f.positionable) f.position += consumed;
    const token = to_luastring(match[1], true);
    const converted = require('../lua.js').lua_stringtonumber(L, token);
    if (converted === 0 || !Number.isFinite(lua_tonumber(L, -1))) {
        if (converted !== 0) lua_pop(L, 1);
        lua_pushnil(L);
        return false;
    }
    return true;
};

const read_one = function(L, f, format) {
    if (typeof format === "string") format = format[0];
    if (typeof format === "number") {
        if (format < 0) luaL_error(L, to_luastring("invalid format", true));
        const data = read_bytes(f, format);
        lua_pushlstring(L, data, data.length);
        return data.length > 0 || (format === 0 && read_ahead(f).length > 0);
    }
    if (format === "l" || format === "L") {
        const data = read_line(f, format === "L");
        if (data === null) { lua_pushnil(L); return false; }
        lua_pushlstring(L, data, data.length);
        return true;
    }
    if (format === "a") {
        const data = read_ahead(f);
        if (f.positionable) f.position += data.length;
        lua_pushlstring(L, data, data.length);
        return true;
    }
    if (format === "n") return read_number(L, f);
    luaL_error(L, to_luastring("invalid format", true));
    return false;
};

const get_formats = function(L, first) {
    const formats = [];
    for (let i = first; i <= lua_gettop(L); i++) {
        if (lua_type(L, i) === LUA_TNUMBER && lua_isinteger(L, i))
            formats.push(Number(lua_tointeger(L, i)));
        else {
            const s = luaL_checklstring(L, i);
            const f = to_jsstring(s);
            if (f[0] === "*") formats.push(f.slice(1));
            else formats.push(f);
        }
    }
    if (formats.length === 0) formats.push("l");
    return formats;
};

const g_read = function(L, f, first) {
    if (!f || typeof f.fd !== "number")
        return luaL_error(L, to_luastring("attempt to use a closed file", true));
    const formats = get_formats(L, first);
    const before = lua_gettop(L);
    let n = 0;
    for (const format of formats) {
        let ok;
        try {
            ok = read_one(L, f, format);
        } catch (e) {
            if (!(e instanceof Error)) throw e;
            return luaL_fileresult(L, false, null, e);
        }
        n++;
        if (!ok) {
            if (n === 1) {
                lua_settop(L, before);
                return 0;
            }
            lua_pop(L, 1);
            lua_pushnil(L);
            break;
        }
    }
    if (n === 0) {
        lua_pushnil(L);
        return 1;
    }
    return lua_gettop(L) - before;
};

const f_read = function(L) {
    const p = tolstream(L);
    if (isclosed(p)) return luaL_error(L, to_luastring("file is already closed", true));
    return g_read(L, p.f, 2);
};

const f_seek = function(L) {
    const p = tolstream(L);
    if (isclosed(p)) return luaL_error(L, to_luastring("file is already closed", true));
    const modes = [to_luastring("set", true), to_luastring("cur", true), to_luastring("end", true), null];
    const which = luaL_checkoption(L, 2, "cur", modes);
    const offset = I64.toBigInt(luaL_optinteger(L, 3, 0));
    if (!p.f.positionable) return luaL_fileresult(L, false, null, new Error("Illegal seek"));
    try { flush_buffer(p.f); } catch (e) { return luaL_fileresult(L, false, null, e); }
    let position;
    if (which === 0) position = offset;
    else if (which === 1) position = BigInt(p.f.position) + offset;
    else position = BigInt(fs.fstatSync(p.f.fd).size) + offset;
    if (position < 0n || position > BigInt(Number.MAX_SAFE_INTEGER))
        return luaL_fileresult(L, false, null, new Error("Invalid argument"));
    p.f.position = Number(position);
    lua_pushinteger(L, p.f.position);
    return 1;
};

const f_lines = function(L) {
    const p = tolstream(L);
    if (isclosed(p)) return luaL_error(L, to_luastring("file is already closed", true));
    const state = { p, formats: get_formats(L, 2), closeOnEnd: false };
    lua_pushlightuserdata(L, state);
    lua_pushcclosure(L, line_iterator, 1);
    return 1;
};

const line_iterator = function(L) {
    const state = lua_touserdata(L, lua_upvalueindex(1));
    if (!state || !state.p || isclosed(state.p))
        return luaL_error(L, to_luastring("file is already closed", true));
    const base = lua_gettop(L);
    let n = 0;
    for (const format of state.formats) {
        let ok;
        try {
            ok = read_one(L, state.p.f, format);
        } catch (e) {
            if (!(e instanceof Error)) throw e;
            return luaL_error(L, to_luastring("%s", true), to_luastring(e.message, true));
        }
        n++;
        if (!ok) {
            if (n === 1) {
                lua_settop(L, base);
                if (state.closeOnEnd) close_file(state.p);
                return 0;
            }
            lua_pop(L, 1);
            lua_pushnil(L);
            break;
        }
    }
    return lua_gettop(L) - base;
};

const io_lines = function(L) {
    let p;
    let closeOnEnd = false;
    if (lua_isnoneornil(L, 1)) {
        lua_getfield(L, LUA_REGISTRYINDEX, IO_INPUT);
        p = lua_touserdata(L, -1);
        lua_pop(L, 1);  /* remove temporary registry handle */
    } else if (lua_type(L, 1) === LUA_TNUMBER || luaL_testudata(L, 1, LUA_FILEHANDLE)) {
        p = luaL_checkudata(L, 1, LUA_FILEHANDLE);
    } else {
        const filename = luaL_checklstring(L, 1);
        lua_pushstring(L, to_luastring("r", true));
        lua_insert(L, 2);  /* io.open expects its mode at argument #2 */
        const n = io_open(L);
        lua_remove(L, 2);  /* restore the caller's line formats */
        if (n !== 1) return luaL_error(L, to_luastring("cannot open file"));
        p = lua_touserdata(L, -1);
        closeOnEnd = true;
        lua_remove(L, -1);
    }
    if (!p || isclosed(p)) return luaL_error(L, to_luastring("file is already closed"));
    const state = { p, formats: get_formats(L, 2), closeOnEnd };
    lua_pushlightuserdata(L, state);
    lua_pushcclosure(L, line_iterator, 1);
    return 1;
};

const aux_close = function(L) {
    let p = tolstream(L);
    let cf = p.closef;
    p.closef = null;
    return cf(L);
};

const io_close = function(L) {
    if (lua_isnone(L, 1))  /* no argument? */
        lua_getfield(L, LUA_REGISTRYINDEX, IO_OUTPUT);  /* use standard output */
    const p = luaL_testudata(L, 1, LUA_FILEHANDLE);
    if (p && isclosed(p))
        return luaL_error(L, to_luastring("attempt to use a closed file", true));
    return f_close(L);
};

const getiofile = function(L, findex) {
    lua_getfield(L, LUA_REGISTRYINDEX, findex);
    let p = lua_touserdata(L, -1);
    if (isclosed(p))
        luaL_error(L, to_luastring("standard %s file is closed"), findex.subarray(IOPREF_LEN));
    return p.f;
};

const g_iofile = function(L, f, mode) {
    if (!lua_isnoneornil(L, 1)) {
        const filename = lua_tostring(L, 1);
        if (filename) {
            lua_pushstring(L, to_luastring(mode, true));
            const n = io_open(L);
            if (n !== 1)
                return luaL_error(L, to_luastring("cannot open file '%s'"), filename);
            lua_setfield(L, LUA_REGISTRYINDEX, f);
        } else {
            tofile(L);  /* check that it's a valid file handle */
            lua_pushvalue(L, 1);
            lua_setfield(L, LUA_REGISTRYINDEX, f);
        }
    }
    /* return current value */
    lua_getfield(L, LUA_REGISTRYINDEX, f);
    return 1;
};

const io_input = function(L) {
    return g_iofile(L, IO_INPUT, "r");
};

const io_output = function(L) {
    return g_iofile(L, IO_OUTPUT, "w");
};

const io_read = function(L) {
    const f = getiofile(L, IO_INPUT);
    lua_pop(L, 1);  /* getiofile leaves the registry handle on the stack */
    return g_read(L, f, 1);
};

/* node <= 6 doesn't support passing a Uint8Array to fs.writeSync */
const prepare_string_for_write = (typeof process !== "undefined" && process.versions.node > 6) ?
    (s) => s :
    (s) => (typeof Buffer !== "undefined" ? Buffer.from(s.buffer, s.byteOffset, s.byteLength) : s);

const g_write = function(L, f, arg) {
    if (!f || typeof f.fd !== "number")
        return luaL_error(L, to_luastring("file is already closed", true));
    let nargs = lua_gettop(L) - arg;
    let status = true;
    let err;
    for (; nargs--; arg++) {
        const s = luaL_checklstring(L, arg);
        try {
            const data = prepare_string_for_write(s);
            const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
            status = status && write_file_data(f, buffer);
        } catch (e) {
            status = false;
            err = e;
        }
    }
    if (status) return 1;  /* file handle already on stack top */
    else return luaL_fileresult(L, status, null, err);
};

const io_write = function(L) {
    return g_write(L, getiofile(L, IO_OUTPUT), 1);
};

const f_write = function(L) {
    let f = tofile(L);
    lua_pushvalue(L, 1); /* push file at the stack top (to be returned) */
    return g_write(L, f, 2);
};

const io_flush = function (L) {
    const f = getiofile(L, IO_OUTPUT);
    try { flush_buffer(f); } catch (e) { return luaL_fileresult(L, false, null, e); }
    return luaL_fileresult(L, true, null, null);
};

const f_flush = function (L) {
    const p = tolstream(L);
    if (isclosed(p)) return luaL_error(L, to_luastring("file is already closed", true));
    try { flush_buffer(p.f); } catch (e) { return luaL_fileresult(L, false, null, e); }
    return luaL_fileresult(L, true, null, null);
};

const f_setvbuf = function(L) {
    const p = tolstream(L);
    if (isclosed(p)) return luaL_error(L, to_luastring("file is already closed", true));
    const modes = [to_luastring("no", true), to_luastring("full", true), to_luastring("line", true), null];
    const mode = luaL_checkoption(L, 2, null, modes);
    const sizeValue = luaL_optinteger(L, 3, 8192);
    const size = Number(I64.toBigInt(sizeValue));
    luaL_argcheck(L, size > 0, 3, to_luastring("invalid size", true));
    try { flush_buffer(p.f); } catch (e) { return luaL_fileresult(L, false, null, e); }
    p.f.bufferMode = ["no", "full", "line"][mode];
    p.f.bufferSize = size;
    return luaL_fileresult(L, true, null, null);
};

const io_tmpfile = function(L) {
    let directory;
    try {
        directory = fs.mkdtempSync("/tmp/luanode-");
        const path = directory + "/tmpfile";
        const fd = fs.openSync(path, "w+");
        const p = newprefile(L);
        p.f = {
            fd, path, directory, temporary: true,
            position: 0, positionable: true, append: false,
            bufferMode: "no", bufferSize: 8192, buffer: [], bufferLength: 0
        };
        p.closef = f_close;
        return 1;
    } catch (e) {
        return luaL_fileresult(L, false, null, e);
    }
};

const iolib = {
    "close": io_close,
    "flush": io_flush,
    "input": io_input,
    "lines": io_lines,
    "open": io_open,
    "output": io_output,
    "tmpfile": io_tmpfile,
    "read": io_read,
    "type": io_type,
    "write": io_write
};

const flib = {
    "close": f_close,
    "flush": f_flush,
    "lines": f_lines,
    "read": f_read,
    "seek": f_seek,
    "setvbuf": f_setvbuf,
    "write": f_write,
    "__gc": f_gc,
    "__tostring": f_tostring
};

const createmeta = function(L) {
    luaL_newmetatable(L, LUA_FILEHANDLE);  /* create metatable for file handles */
    lua_pushvalue(L, -1);  /* push metatable */
    lua_setfield(L, -2, to_luastring("__index", true));  /* metatable.__index = metatable */
    luaL_setfuncs(L, flib, 0);  /* add file methods to new metatable */
    lua_pop(L, 1);  /* pop new metatable */
};

const io_noclose = function(L) {
    let p = tolstream(L);
    p.closef = io_noclose;
    lua_pushnil(L);
    lua_pushliteral(L, "cannot close standard file");
    return 2;
};

const createstdfile = function(L, f, k, fname) {
    let p = newprefile(L);
    p.f = f;
    p.closef = io_noclose;
    if (k !== null) {
        lua_pushvalue(L, -1);
        lua_setfield(L, LUA_REGISTRYINDEX, k);  /* add file to registry */
    }
    lua_setfield(L, -2, fname);  /* add file to module */
};

const luaopen_io = function(L) {
    luaL_newlib(L, iolib);
    createmeta(L);
    /* create (and set) default files */
    const noopStdStream = { fd: -1, write() { return true; }, on() {} };
    const stdin  = (typeof process !== "undefined") ? process.stdin  : noopStdStream;
    const stdout = (typeof process !== "undefined") ? process.stdout : noopStdStream;
    const stderr = (typeof process !== "undefined") ? process.stderr : noopStdStream;
    createstdfile(L, stdin, IO_INPUT, to_luastring("stdin"));
    createstdfile(L, stdout, IO_OUTPUT, to_luastring("stdout"));
    createstdfile(L, stderr, null, to_luastring("stderr"));
    return 1;
};

module.exports.luaopen_io = luaopen_io;
