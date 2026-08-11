"use strict";

/*
** ldebug.js — Debug interface for the LuaNode-VM.
**
** Provides source-level debugging support: stack introspection
** (lua_getstack), function info (lua_getinfo), local variable
** access (lua_getlocal / lua_setlocal), hooks (lua_sethook /
** lua_gethook), and runtime error reporting helpers (luaG_runerror,
** luaG_typeerror, luaG_concaterror, …).
**
** Modernized from the original Fengari implementation:
**   - var → let / const throughout
**   - Arrow functions for short helpers
**   - Clearer const naming for opcode enum references
**   - JSDoc comments on public API functions
**   - Removed redundant parentheses and dead branches
*/

const {
    LUA_HOOKCOUNT,
    LUA_HOOKLINE,
    LUA_MASKCOUNT,
    LUA_MASKLINE,
    constant_types: {
        LUA_TBOOLEAN,
        LUA_TNIL,
        LUA_TTABLE
    },
    thread_status: {
        LUA_ERRRUN,
        LUA_YIELD
    },
    from_userstring,
    luastring_eq,
    luastring_indexOf,
    to_luastring
} = require('../defs.js');
const {
    api_check,
    lua_assert
} = require('./llimits.js');
const { LUA_IDSIZE } = require('../luaconf.js');
const lapi     = require('./lapi.js');
const ldo      = require('./ldo.js');
const lfunc    = require('./lfunc.js');
const llex     = require('./llex.js');
const lobject  = require('./lobject.js');
const lopcodes = require('./lopcodes.js');
const lstate   = require('./lstate.js');
const ltable   = require('./ltable.js');
const ltm      = require('./ltm.js');
const lvm      = require('./lvm.js');

const OCi = lopcodes.OpCodesI;  /* cached opcode enum for hot paths */

/* current program counter (relative to function start) */
const currentpc = (ci) => {
    lua_assert(ci.callstatus & lstate.CIST_LUA);
    return ci.l_savedpc - 1;
};

/* current line being executed */
const currentline = (ci) => {
    const info = ci.func.value.p.lineinfo;
    return info.length !== 0 ? info[currentpc(ci)] : -1;
};

/*
** If function yielded, its 'func' can be in the 'extra' field. The
** next function restores 'func' to its correct value for debugging
** purposes. (It exchanges 'func' and 'extra'; so, when called again,
** after debugging, it also "re-restores" 'func' to its altered value.)
*/
const swapextra = (L) => {
    if (L.status === LUA_YIELD) {
        const ci = L.ci;
        const temp = ci.funcOff;
        ci.func = L.stack[ci.extra];
        ci.funcOff = ci.extra;
        ci.extra = temp;
    }
};

/**
 * Set a debugging hook function.
 * @param {lua_State} L     - the Lua state
 * @param {Function|null} func - the hook callback or null to disable
 * @param {number} mask     - bitmask of LUA_MASKLINE / LUA_MASKCOUNT
 * @param {number} count    - count interval for count hooks
 */
const lua_sethook = (L, func, mask, count) => {
    if (func === null || mask === 0) {
        mask = 0;
        func = null;
    }
    if (L.ci.callstatus & lstate.CIST_LUA)
        L.oldpc = L.ci.l_savedpc;
    L.hook = func;
    L.basehookcount = count;
    L.hookcount = L.basehookcount;
    L.hookmask = mask;
};

const lua_gethook = (L) => L.hook;
const lua_gethookmask = (L) => L.hookmask;
const lua_gethookcount = (L) => L.basehookcount;

/**
 * Get information about a stack frame at the given level.
 * @returns {number} 1 if the level exists (fills ar.i_ci), 0 otherwise
 */
const lua_getstack = (L, level, ar) => {
    if (level < 0) return 0;  /* invalid (negative) level */
    let ci;
    for (ci = L.ci; level > 0 && ci !== L.base_ci; ci = ci.previous)
        level--;
    if (level === 0 && ci !== L.base_ci) {
        ar.i_ci = ci;
        return 1;
    }
    return 0;
};

const upvalname = (p, uv) => {
    lua_assert(uv < p.upvalues.length);
    const s = p.upvalues[uv].name;
    return s === null ? to_luastring("?", true) : s.getstr();
};

const findvararg = (ci, n) => {
    const nparams = ci.func.value.p.numparams;
    if (n >= ci.l_base - ci.funcOff - nparams)
        return null;
    return {
        pos: ci.funcOff + nparams + n,
        name: to_luastring("(*vararg)", true)
    };
};

const findlocal = (L, ci, n) => {
    let base;
    let name = null;

    if (ci.callstatus & lstate.CIST_LUA) {
        if (n < 0)
            return findvararg(ci, -n);
        base = ci.l_base;
        name = lfunc.luaF_getlocalname(ci.func.value.p, n, currentpc(ci));
    } else
        base = ci.funcOff + 1;

    if (name === null) {
        const limit = ci === L.ci ? L.top : ci.next.funcOff;
        if (limit - base >= n && n > 0)
            name = to_luastring("(*temporary)", true);
        else
            return null;
    }
    return { pos: base + (n - 1), name: name };
};

const lua_getlocal = (L, ar, n) => {
    let name;
    swapextra(L);
    if (ar === null) {
        if (!L.stack[L.top - 1].ttisLclosure())
            name = null;
        else
            name = lfunc.luaF_getlocalname(L.stack[L.top - 1].value.p, n, 0);
    } else {
        const local = findlocal(L, ar.i_ci, n);
        if (local) {
            name = local.name;
            lobject.pushobj2s(L, L.stack[local.pos]);
            api_check(L, L.top <= L.ci.top, "stack overflow");
        } else {
            name = null;
        }
    }
    swapextra(L);
    return name;
};

const lua_setlocal = (L, ar, n) => {
    let name;
    swapextra(L);
    const local = findlocal(L, ar.i_ci, n);
    if (local) {
        name = local.name;
        lobject.setobjs2s(L, local.pos, L.top - 1);
        delete L.stack[--L.top];
    } else {
        name = null;
    }
    swapextra(L);
    return name;
};

const funcinfo = (ar, cl) => {
    if (cl === null || cl instanceof lobject.CClosure) {
        ar.source = to_luastring("=[JS]", true);
        ar.linedefined = -1;
        ar.lastlinedefined = -1;
        ar.what = to_luastring("J", true);
    } else {
        const p = cl.p;
        ar.source = p.source ? p.source.getstr() : to_luastring("=?", true);
        ar.linedefined = p.linedefined;
        ar.lastlinedefined = p.lastlinedefined;
        ar.what = ar.linedefined === 0 ? to_luastring("main", true) : to_luastring("Lua", true);
    }
    ar.short_src = lobject.luaO_chunkid(ar.source, LUA_IDSIZE);
};

const collectvalidlines = (L, f) => {
    if (f === null || f instanceof lobject.CClosure) {
        L.stack[L.top] = new lobject.TValue(LUA_TNIL, null);
        lapi.api_incr_top(L);
    } else {
        const lineinfo = f.p.lineinfo;
        const t = ltable.luaH_new(L);
        L.stack[L.top] = new lobject.TValue(LUA_TTABLE, t);
        lapi.api_incr_top(L);
        const v = new lobject.TValue(LUA_TBOOLEAN, true);
        for (let i = 0; i < lineinfo.length; i++)
            ltable.luaH_setint(t, lineinfo[i], v);
    }
};

const getfuncname = (L, ci) => {
    if (ci === null)
        return null;
    if (ci.callstatus & lstate.CIST_FIN) {
        return {
            name: to_luastring("__gc", true),
            funcname: to_luastring("metamethod", true)
        };
    }
    if (!(ci.callstatus & lstate.CIST_TAIL) && ci.previous.callstatus & lstate.CIST_LUA)
        return funcnamefromcode(L, ci.previous);
    return null;
};

const auxgetinfo = (L, what, ar, f, ci) => {
    let status = 1;
    for (; what.length > 0; what = what.subarray(1)) {
        switch (what[0]) {
            case 83 /* 'S' */:
                funcinfo(ar, f);
                break;
            case 108 /* 'l' */:
                ar.currentline = ci && ci.callstatus & lstate.CIST_LUA ? currentline(ci) : -1;
                break;
            case 117 /* 'u' */:
                ar.nups = f === null ? 0 : f.nupvalues;
                if (f === null || f instanceof lobject.CClosure) {
                    ar.isvararg = true;
                    ar.nparams = 0;
                } else {
                    ar.isvararg = f.p.is_vararg;
                    ar.nparams = f.p.numparams;
                }
                break;
            case 116 /* 't' */:
                ar.istailcall = ci ? ci.callstatus & lstate.CIST_TAIL : 0;
                break;
            case 110 /* 'n' */: {
                const r = getfuncname(L, ci);
                if (r === null) {
                    ar.namewhat = to_luastring("", true);
                    ar.name = null;
                } else {
                    ar.namewhat = r.funcname;
                    ar.name = r.name;
                }
                break;
            }
            case 76 /* 'L' */:
            case 102 /* 'f' */:
                break;  /* handled by lua_getinfo */
            default:
                status = 0;
        }
    }
    return status;
};

const lua_getinfo = (L, what, ar) => {
    what = from_userstring(what);
    let status, cl, ci, func;
    swapextra(L);
    if (what[0] === 62 /* '>' */) {
        ci = null;
        func = L.stack[L.top - 1];
        api_check(L, func.ttisfunction(), "function expected");
        what = what.subarray(1);
        L.top--;
    } else {
        ci = ar.i_ci;
        func = ci.func;
        lua_assert(ci.func.ttisfunction());
    }

    cl = func.ttisclosure() ? func.value : null;
    status = auxgetinfo(L, what, ar, cl, ci);
    if (luastring_indexOf(what, 102 /* 'f' */) >= 0) {
        lobject.pushobj2s(L, func);
        api_check(L, L.top <= L.ci.top, "stack overflow");
    }

    swapextra(L);
    if (luastring_indexOf(what, 76 /* 'L' */) >= 0)
        collectvalidlines(L, cl);

    return status;
};

const kname = (p, pc, c) => {
    const r = { name: null, funcname: null };

    if (lopcodes.ISK(c)) {
        const kvalue = p.k[lopcodes.INDEXK(c)];
        if (kvalue.ttisstring()) {
            r.name = kvalue.svalue();
            return r;
        }
    } else {
        const what = getobjname(p, pc, c);
        if (what && what.funcname[0] === 99 /* 'c' */)
            return what;
    }
    r.name = to_luastring("?", true);
    return r;
};

const filterpc = (pc, jmptarget) =>
    (pc < jmptarget) ? -1 : pc;

/*
** try to find last instruction before 'lastpc' that modified register 'reg'
*/
const findsetreg = (p, lastpc, reg) => {
    let setreg = -1;
    let jmptarget = 0;
    for (let pc = 0; pc < lastpc; pc++) {
        const i = p.code[pc];
        const a = i.A;
        switch (i.opcode) {
            case OCi.OP_LOADNIL: {
                const b = i.B;
                if (a <= reg && reg <= a + b)
                    setreg = filterpc(pc, jmptarget);
                break;
            }
            case OCi.OP_TFORCALL:
                if (reg >= a + 2)
                    setreg = filterpc(pc, jmptarget);
                break;
            case OCi.OP_CALL:
            case OCi.OP_TAILCALL:
                if (reg >= a)
                    setreg = filterpc(pc, jmptarget);
                break;
            case OCi.OP_JMP: {
                const b = i.sBx;
                const dest = pc + 1 + b;
                if (pc < dest && dest <= lastpc) {
                    if (dest > jmptarget)
                        jmptarget = dest;
                }
                break;
            }
            default:
                if (lopcodes.testAMode(i.opcode) && reg === a)
                    setreg = filterpc(pc, jmptarget);
                break;
        }
    }
    return setreg;
};

const getobjname = (p, lastpc, reg) => {
    const r = {
        name: lfunc.luaF_getlocalname(p, reg + 1, lastpc),
        funcname: null
    };

    if (r.name) {
        r.funcname = to_luastring("local", true);
        return r;
    }

    const pc = findsetreg(p, lastpc, reg);
    if (pc !== -1) {
        const i = p.code[pc];
        switch (i.opcode) {
            case OCi.OP_MOVE: {
                const b = i.B;
                if (b < i.A)
                    return getobjname(p, pc, b);
                break;
            }
            case OCi.OP_GETTABUP:
            case OCi.OP_GETTABLE: {
                const k = i.C;
                const t = i.B;
                const vn = i.opcode === OCi.OP_GETTABLE ? lfunc.luaF_getlocalname(p, t + 1, pc) : upvalname(p, t);
                r.name = kname(p, pc, k).name;
                r.funcname = (vn && luastring_eq(vn, llex.LUA_ENV)) ? to_luastring("global", true) : to_luastring("field", true);
                return r;
            }
            case OCi.OP_GETUPVAL:
                r.name = upvalname(p, i.B);
                r.funcname = to_luastring("upvalue", true);
                return r;
            case OCi.OP_LOADK:
            case OCi.OP_LOADKX: {
                const b = i.opcode === OCi.OP_LOADK ? i.Bx : p.code[pc + 1].Ax;
                if (p.k[b].ttisstring()) {
                    r.name = p.k[b].svalue();
                    r.funcname = to_luastring("constant", true);
                    return r;
                }
                break;
            }
            case OCi.OP_SELF:
                r.name = kname(p, pc, i.C).name;
                r.funcname = to_luastring("method", true);
                return r;
            default:
                break;
        }
    }
    return null;
};

/*
** Try to find a name for a function based on the code that called it.
*/
const funcnamefromcode = (L, ci) => {
    const r = { name: null, funcname: null };

    let tm = 0;
    const p = ci.func.value.p;
    const pc = currentpc(ci);
    const i = p.code[pc];

    if (ci.callstatus & lstate.CIST_HOOKED) {
        r.name = to_luastring("?", true);
        r.funcname = to_luastring("hook", true);
        return r;
    }

    switch (i.opcode) {
        case OCi.OP_CALL:
        case OCi.OP_TAILCALL:
            return getobjname(p, pc, i.A);
        case OCi.OP_TFORCALL:
            r.name = to_luastring("for iterator", true);
            r.funcname = to_luastring("for iterator", true);
            return r;
        case OCi.OP_SELF:
        case OCi.OP_GETTABUP:
        case OCi.OP_GETTABLE:
            tm = ltm.TMS.TM_INDEX;
            break;
        case OCi.OP_SETTABUP:
        case OCi.OP_SETTABLE:
            tm = ltm.TMS.TM_NEWINDEX;
            break;
        case OCi.OP_ADD:    tm = ltm.TMS.TM_ADD;    break;
        case OCi.OP_SUB:    tm = ltm.TMS.TM_SUB;    break;
        case OCi.OP_MUL:    tm = ltm.TMS.TM_MUL;    break;
        case OCi.OP_MOD:    tm = ltm.TMS.TM_MOD;    break;
        case OCi.OP_POW:    tm = ltm.TMS.TM_POW;    break;
        case OCi.OP_DIV:    tm = ltm.TMS.TM_DIV;    break;
        case OCi.OP_IDIV:   tm = ltm.TMS.TM_IDIV;   break;
        case OCi.OP_BAND:   tm = ltm.TMS.TM_BAND;   break;
        case OCi.OP_BOR:    tm = ltm.TMS.TM_BOR;    break;
        case OCi.OP_BXOR:   tm = ltm.TMS.TM_BXOR;   break;
        case OCi.OP_SHL:    tm = ltm.TMS.TM_SHL;    break;
        case OCi.OP_SHR:    tm = ltm.TMS.TM_SHR;    break;
        case OCi.OP_UNM:    tm = ltm.TMS.TM_UNM;    break;
        case OCi.OP_BNOT:   tm = ltm.TMS.TM_BNOT;   break;
        case OCi.OP_LEN:    tm = ltm.TMS.TM_LEN;    break;
        case OCi.OP_CONCAT: tm = ltm.TMS.TM_CONCAT; break;
        case OCi.OP_EQ:     tm = ltm.TMS.TM_EQ;     break;
        case OCi.OP_LT:     tm = ltm.TMS.TM_LT;     break;
        case OCi.OP_LE:     tm = ltm.TMS.TM_LE;     break;
        default:
            return null;
    }

    r.name = L.l_G.tmname[tm].getstr();
    r.funcname = to_luastring("metamethod", true);
    return r;
};

const isinstack = (L, ci, o) => {
    for (let i = ci.l_base; i < ci.top; i++) {
        if (L.stack[i] === o)
            return i;
    }
    return false;
};

const getupvalname = (L, ci, o) => {
    const c = ci.func.value;
    for (let i = 0; i < c.nupvalues; i++) {
        if (c.upvals[i] === o) {
            return {
                name: upvalname(c.p, i),
                funcname: to_luastring('upvalue', true)
            };
        }
    }
    return null;
};

const varinfo = (L, o) => {
    const ci = L.ci;
    let kind = null;
    if (ci.callstatus & lstate.CIST_LUA) {
        kind = getupvalname(L, ci, o);
        const stkid = isinstack(L, ci, o);
        if (!kind && stkid)
            kind = getobjname(ci.func.value.p, currentpc(ci), stkid - ci.l_base);
    }
    return kind ? lobject.luaO_pushfstring(L, to_luastring(" (%s '%s')", true), kind.funcname, kind.name) : to_luastring("", true);
};

const luaG_typeerror = (L, o, op) => {
    const t = ltm.luaT_objtypename(L, o);
    luaG_runerror(L, to_luastring("attempt to %s a %s value%s", true), op, t, varinfo(L, o));
};

const luaG_concaterror = (L, p1, p2) => {
    if (p1.ttisstring() || lvm.cvt2str(p1)) p1 = p2;
    luaG_typeerror(L, p1, to_luastring('concatenate', true));
};

const luaG_opinterror = (L, p1, p2, msg) => {
    if (lvm.tonumber(p1) === false)
        p2 = p1;
    luaG_typeerror(L, p2, msg);
};

const luaG_ordererror = (L, p1, p2) => {
    const t1 = ltm.luaT_objtypename(L, p1);
    const t2 = ltm.luaT_objtypename(L, p2);
    if (luastring_eq(t1, t2))
        luaG_runerror(L, to_luastring("attempt to compare two %s values", true), t1);
    else
        luaG_runerror(L, to_luastring("attempt to compare %s with %s", true), t1, t2);
};

/* add src:line information to 'msg' */
const luaG_addinfo = (L, msg, src, line) => {
    let buff;
    if (src)
        buff = lobject.luaO_chunkid(src.getstr(), LUA_IDSIZE);
    else
        buff = to_luastring("?", true);
    return lobject.luaO_pushfstring(L, to_luastring("%s:%d: %s", true), buff, line, msg);
};

const luaG_runerror = (L, fmt, ...argp) => {
    const ci = L.ci;
    const msg = lobject.luaO_pushvfstring(L, fmt, argp);
    if (ci.callstatus & lstate.CIST_LUA)
        luaG_addinfo(L, msg, ci.func.value.p.source, currentline(ci));
    luaG_errormsg(L);
};

const luaG_errormsg = (L) => {
    if (L.errfunc !== 0) {
        const errfunc = L.errfunc;
        lobject.pushobj2s(L, L.stack[L.top - 1]);
        lobject.setobjs2s(L, L.top - 2, errfunc);
        ldo.luaD_callnoyield(L, L.top - 2, 1);
    }
    ldo.luaD_throw(L, LUA_ERRRUN);
};

const luaG_tointerror = (L, p1, p2) => {
    const temp = lvm.tointeger(p1);
    if (temp === false)
        p2 = p1;
    luaG_runerror(L, to_luastring("number%s has no integer representation", true), varinfo(L, p2));
};

const luaG_traceexec = (L) => {
    const ci = L.ci;
    const mask = L.hookmask;
    const counthook = (--L.hookcount === 0 && (mask & LUA_MASKCOUNT));
    if (counthook)
        L.hookcount = L.basehookcount;
    else if (!(mask & LUA_MASKLINE))
        return;
    if (ci.callstatus & lstate.CIST_HOOKYIELD) {
        ci.callstatus &= ~lstate.CIST_HOOKYIELD;
        return;
    }
    if (counthook)
        ldo.luaD_hook(L, LUA_HOOKCOUNT, -1);
    if (mask & LUA_MASKLINE) {
        const p = ci.func.value.p;
        const npc = ci.l_savedpc - 1;
        const newline = p.lineinfo.length !== 0 ? p.lineinfo[npc] : -1;
        if (npc === 0 ||
            ci.l_savedpc <= L.oldpc ||
            newline !== (p.lineinfo.length !== 0 ? p.lineinfo[L.oldpc - 1] : -1))
            ldo.luaD_hook(L, LUA_HOOKLINE, newline);
    }
    L.oldpc = ci.l_savedpc;
    if (L.status === LUA_YIELD) {
        if (counthook)
            L.hookcount = 1;
        ci.l_savedpc--;
        ci.callstatus |= lstate.CIST_HOOKYIELD;
        ci.funcOff = L.top - 1;
        ci.func = L.stack[ci.funcOff];
        ldo.luaD_throw(L, LUA_YIELD);
    }
};

module.exports.luaG_addinfo     = luaG_addinfo;
module.exports.luaG_concaterror = luaG_concaterror;
module.exports.luaG_errormsg    = luaG_errormsg;
module.exports.luaG_opinterror  = luaG_opinterror;
module.exports.luaG_ordererror  = luaG_ordererror;
module.exports.luaG_runerror    = luaG_runerror;
module.exports.luaG_tointerror  = luaG_tointerror;
module.exports.luaG_traceexec   = luaG_traceexec;
module.exports.luaG_typeerror   = luaG_typeerror;
module.exports.lua_gethook      = lua_gethook;
module.exports.lua_gethookcount = lua_gethookcount;
module.exports.lua_gethookmask  = lua_gethookmask;
module.exports.lua_getinfo      = lua_getinfo;
module.exports.lua_getlocal     = lua_getlocal;
module.exports.lua_getstack     = lua_getstack;
module.exports.lua_sethook      = lua_sethook;
module.exports.lua_setlocal     = lua_setlocal;
