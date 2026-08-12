"use strict";

const { LUA_MAXINTEGER } = require('../luaconf.js');
const I64 = require('../vm/lint64.js');
const {
    LUA_OPEQ,
    LUA_OPLT,
    LUA_TFUNCTION,
    LUA_TNIL,
    LUA_TTABLE,
    lua_call,
    lua_checkstack,
    lua_compare,
    lua_createtable,
    lua_geti,
    lua_getmetatable,
    lua_gettop,
    lua_insert,
    lua_isnil,
    lua_isnoneornil,
    lua_isstring,
    lua_pop,
    lua_pushinteger,
    lua_pushnil,
    lua_pushstring,
    lua_pushvalue,
    lua_rawget,
    lua_rawgeti,
    lua_rawlen,
    lua_rawseti,
    lua_setfield,
    lua_seti,
    lua_settop,
    lua_toboolean,
    lua_type
} = require('../lua.js');
const {
    luaL_Buffer,
    luaL_addlstring,
    luaL_addvalue,
    luaL_argcheck,
    luaL_buffinit,
    luaL_checkinteger,
    luaL_checktype,
    luaL_error,
    luaL_len,
    luaL_newlib,
    luaL_opt,
    luaL_optinteger,
    luaL_optlstring,
    luaL_pushresult,
    luaL_typename
} = require('../lauxlib.js');
const lualib = require('./lualib.js');
const lvm = require('../vm/lvm.js');
const lobject = require('../vm/lobject.js');
const { OpCodesI } = require('../vm/lopcodes.js');
const { to_luastring } = require("../fengaricore.js");

/*
** Operations that an object must define to mimic a table
** (some functions only need some of them)
*/
const TAB_R  = 1;               /* read */
const TAB_W  = 2;               /* write */
const TAB_L  = 4;               /* length */
const TAB_RW = (TAB_R | TAB_W); /* read/write */

const checkfield = function(L, key, n) {
    lua_pushstring(L, key);
    return lua_rawget(L, -n) !== LUA_TNIL;
};

/*
** Check that 'arg' either is a table or can behave like one (that is,
** has a metatable with the required metamethods)
*/
const checktab = function(L, arg, what) {
    if (lua_type(L, arg) !== LUA_TTABLE) {  /* is it not a table? */
        let n = 1;
        if (lua_getmetatable(L, arg) &&  /* must have metatable */
            (!(what & TAB_R) || checkfield(L, to_luastring("__index", true), ++n)) &&
            (!(what & TAB_W) || checkfield(L, to_luastring("__newindex", true), ++n)) &&
            (!(what & TAB_L) || checkfield(L, to_luastring("__len", true), ++n))) {
            lua_pop(L, n);  /* pop metatable and tested metamethods */
        }
        else
            luaL_checktype(L, arg, LUA_TTABLE);  /* force an error */
    }
};

const aux_getn = function(L, n, w) {
    checktab(L, n, w | TAB_L);
    return luaL_len(L, n);
};

/* A real table with no read/write metamethods must be manipulated through
   raw access after the length check. This matters when __len mutates the
   metatable while table.insert is computing the insertion point. */
const has_raw_rw = function(L, n) {
    if (lua_type(L, n) !== LUA_TTABLE) return false;
    const top = lua_gettop(L);
    let raw = true;
    if (lua_getmetatable(L, n)) {
        lua_pushstring(L, to_luastring("__index", true));
        if (lua_rawget(L, -2) !== LUA_TNIL) raw = false;
        lua_pop(L, 1);
        lua_pushstring(L, to_luastring("__newindex", true));
        if (lua_rawget(L, -2) !== LUA_TNIL) raw = false;
        lua_pop(L, 1);
    }
    lua_settop(L, top);
    return raw;
};

const addfield = function(L, b, i) {
    lua_geti(L, 1, i);
    if (!lua_isstring(L, -1))
        luaL_error(L, to_luastring("invalid value (%s) at index %d in table for 'concat'"),
            luaL_typename(L, -1), i);

    luaL_addvalue(b);
};

const tinsert = function(L) {
    const raw = has_raw_rw(L, 1);
    let e = aux_getn(L, 1, TAB_RW) + 1;
    let pos;
    switch (lua_gettop(L)) {
        case 2:
            pos = e;
            break;
        case 3: {
            pos = luaL_checkinteger(L, 2);  /* 2nd argument is the position */
            luaL_argcheck(L, 1 <= pos && pos <= e, 2, "position out of bounds");
            for (let i = e; i > pos; i--) {  /* move up elements */
                if (raw) lua_rawgeti(L, 1, i - 1);
                else lua_geti(L, 1, i - 1);
                if (raw) lua_rawseti(L, 1, i);
                else lua_seti(L, 1, i);  /* t[i] = t[i - 1] */
            }
            break;
        }
        default: {
            return luaL_error(L, "wrong number of arguments to 'insert'");
        }
    }

    if (raw) lua_rawseti(L, 1, pos);
    else lua_seti(L, 1, pos);  /* t[pos] = v */
    return 0;
};

const tremove = function(L) {
    let size = aux_getn(L, 1, TAB_RW);
    let pos = luaL_optinteger(L, 2, size);
    if (pos !== size)  /* validate 'pos' if given */
        luaL_argcheck(L, 1 <= pos && pos <= size + 1, 1, "position out of bounds");
    lua_geti(L, 1, pos);  /* result = t[pos] */
    for (; pos < size; pos++) {
        lua_geti(L, 1, pos + 1);
        lua_seti(L, 1, pos);  /* t[pos] = t[pos + 1] */
    }
    lua_pushnil(L);
    lua_seti(L, 1, pos);  /* t[pos] = nil */
    return 1;
};

/*
** Copy elements (1[f], ..., 1[e]) into (tt[t], tt[t+1], ...). Whenever
** possible, copy in increasing order, which is better for rehashing.
** "possible" means destination after original range, or smaller
** than origin, or copying to another table.
*/
const tmove = function(L) {
    let f = luaL_checkinteger(L, 2);
    let e = luaL_checkinteger(L, 3);
    let t = luaL_checkinteger(L, 4);
    let tt = !lua_isnoneornil(L, 5) ? 5 : 1;  /* destination table */
    checktab(L, 1, TAB_R);
    checktab(L, tt, TAB_W);
    luaL_argcheck(L, I64.lt(0, f), 2, "must be positive");
    if (e >= f) {  /* otherwise, nothing to move */
        luaL_argcheck(L, I64.lt(0, f) || I64.lt(e, I64.add(LUA_MAXINTEGER, f)), 3, "too many elements to move");
        let n = I64.sub(I64.add(e, 1), f);  /* number of elements to move */
        luaL_argcheck(L, I64.le(t, I64.add(I64.sub(LUA_MAXINTEGER, n), 1)), 4, "destination wrap around");

        if (t > e || t <= f || (tt !== 1 && lua_compare(L, 1, tt, LUA_OPEQ) !== 1)) {
            for (let i = 0; i < n; i++) {
                lua_geti(L, 1, I64.add(f, i));
                lua_seti(L, tt, I64.add(t, i));
            }
        } else {
            for (let i = n - 1; i >= 0; i--) {
                lua_geti(L, 1, f + i);
                lua_seti(L, tt, t + i);
            }
        }
    }

    lua_pushvalue(L, tt);  /* return destination table */
    return 1;
};

const tconcat = function(L) {
    let last = aux_getn(L, 1, TAB_R);
    let sep = luaL_optlstring(L, 2, "");
    let lsep = sep.length;
    let i = luaL_optinteger(L, 3, 1);
    last = luaL_optinteger(L, 4, last);

    let b = new luaL_Buffer();
    luaL_buffinit(L, b);

    for (; i < last; i++) {
        addfield(L, b, i);
        luaL_addlstring(b, sep, lsep);
    }

    if (i === last)
        addfield(L, b, i);

    luaL_pushresult(b);

    return 1;
};

const pack = function(L) {
    let n = lua_gettop(L);  /* number of elements to pack */
    lua_createtable(L, n, 1);  /* create result table */
    lua_insert(L, 1);  /* put it at index 1 */
    for (let i = n; i >= 1; i--)  /* assign elements */
        lua_seti(L, 1, i);
    lua_pushinteger(L, n);
    lua_setfield(L, 1, to_luastring("n"));  /* t.n = number of elements */
    return 1;  /* return table */
};

const unpack = function(L) {
    /* Keep the range arithmetic exact for math.mininteger/maxinteger. */
    let i = BigInt(luaL_optinteger(L, 2, 1));
    let e = BigInt(luaL_opt(L, luaL_checkinteger, 3, luaL_len(L, 1)));
    if (i > e) return 0;  /* empty range */

    let count = e - i;  /* number of elements minus 1 (avoid overflows) */
    if (count >= BigInt(Number.MAX_SAFE_INTEGER))
        return luaL_error(L, to_luastring("too many results to unpack"));

    const n = Number(count + 1n);
    if (!lua_checkstack(L, n))
        return luaL_error(L, to_luastring("too many results to unpack"));
    for (; i < e; i++)  /* push arg[i..e - 1] (to avoid overflows) */
        lua_geti(L, 1, I64.normalize(i));
    lua_geti(L, 1, I64.normalize(e));  /* push last element */
    return n;
};

const l_randomizePivot = function() {
    return Math.floor(Math.random()*0x100000000);
};

const RANLIMIT = 100;

const getitem = function(L, raw, i) {
    return raw ? lua_rawgeti(L, 1, i) : lua_geti(L, 1, i);
};

const set2 = function(L, i, j, raw) {
    if (raw) {
        lua_rawseti(L, 1, i);
        lua_rawseti(L, 1, j);
    } else {
        lua_seti(L, 1, i);
        lua_seti(L, 1, j);
    }
};

const sort_comp = function(L, a, b) {
    if (lua_isnil(L, 2))  /* no function? */
        return lua_compare(L, a, b, LUA_OPLT);  /* a < b */
    else {  /* function */
        lua_pushvalue(L, 2);    /* push function */
        lua_pushvalue(L, a-1);  /* -1 to compensate function */
        lua_pushvalue(L, b-2);  /* -2 to compensate function and 'a' */
        lua_call(L, 2, 1);      /* call function */
        let res = lua_toboolean(L, -1);  /* get result */
        lua_pop(L, 1);          /* pop result */
        return res;
    }
};

const partition = function(L, lo, up, raw) {
    let i = lo;  /* will be incremented before first use */
    let j = up - 1;  /* will be decremented before first use */
    /* loop invariant: a[lo .. i] <= P <= a[j .. up] */
    for (;;) {
        /* next loop: repeat ++i while a[i] < P */
        while (getitem(L, raw, ++i), sort_comp(L, -1, -2)) {
            if (i == up - 1)  /* a[i] < P  but a[up - 1] == P  ?? */
                luaL_error(L, to_luastring("invalid order function for sorting"));
            lua_pop(L, 1);  /* remove a[i] */
        }
        /* after the loop, a[i] >= P and a[lo .. i - 1] < P */
        /* next loop: repeat --j while P < a[j] */
        while (getitem(L, raw, --j), sort_comp(L, -3, -1)) {
            if (j < i)  /* j < i  but  a[j] > P ?? */
                luaL_error(L, to_luastring("invalid order function for sorting"));
            lua_pop(L, 1);  /* remove a[j] */
        }
        /* after the loop, a[j] <= P and a[j + 1 .. up] >= P */
        if (j < i) {  /* no elements out of place? */
            /* a[lo .. i - 1] <= P <= a[j + 1 .. i .. up] */
            lua_pop(L, 1);  /* pop a[j] */
            /* swap pivot (a[up - 1]) with a[i] to satisfy pos-condition */
            set2(L, up - 1, i, raw);
            return i;
        }
        /* otherwise, swap a[i] - a[j] to restore invariant and repeat */
        set2(L, i, j, raw);
    }
};

const choosePivot = function(lo, up, rnd) {
    let r4 = Math.floor((up - lo) / 4);  /* range/4 */
    let p = rnd % (r4 * 2) + (lo + r4);
    lualib.lua_assert(lo + r4 <= p && p <= up - r4);
    return p;
};

const auxsort = function(L, lo, up, rnd, raw) {
    while (lo < up) {  /* loop for tail recursion */
        /* sort elements 'lo', 'p', and 'up' */
        getitem(L, raw, lo);
        getitem(L, raw, up);
        if (sort_comp(L, -1, -2))  /* a[up] < a[lo]? */
            set2(L, lo, up, raw);  /* swap a[lo] - a[up] */
        else
            lua_pop(L, 2);  /* remove both values */
        if (up - lo == 1)  /* only 2 elements? */
            return;  /* already sorted */
        let p;  /* Pivot index */
        if (up - lo < RANLIMIT || rnd === 0)  /* small interval or no randomize? */
            p = Math.floor((lo + up)/2);  /* middle element is a good pivot */
        else  /* for larger intervals, it is worth a random pivot */
            p = choosePivot(lo, up, rnd);
        getitem(L, raw, p);
        getitem(L, raw, lo);
        if (sort_comp(L, -2, -1))  /* a[p] < a[lo]? */
            set2(L, p, lo, raw);  /* swap a[p] - a[lo] */
        else {
            lua_pop(L, 1);  /* remove a[lo] */
            getitem(L, raw, up);
            if (sort_comp(L, -1, -2))  /* a[up] < a[p]? */
                set2(L, p, up, raw);  /* swap a[up] - a[p] */
            else
                lua_pop(L, 2);
        }
        if (up - lo == 2)  /* only 3 elements? */
            return;  /* already sorted */
        getitem(L, raw, p);  /* get middle element (Pivot) */
        lua_pushvalue(L, -1);  /* push Pivot */
        getitem(L, raw, up - 1);  /* push a[up - 1] */
        set2(L, p, up - 1, raw);  /* swap Pivot (a[p]) with a[up - 1] */
        p = partition(L, lo, up, raw);
        let n;
        /* a[lo .. p - 1] <= a[p] == P <= a[p + 1 .. up] */
        if (p - lo < up - p) {  /* lower interval is smaller? */
            auxsort(L, lo, p - 1, rnd, raw);  /* call recursively for lower interval */
            n = p - lo;  /* size of smaller interval */
            lo = p + 1;  /* tail call for [p + 1 .. up] (upper interval) */
        } else {
            auxsort(L, p + 1, up, rnd, raw);  /* call recursively for upper interval */
            n = up - p;  /* size of smaller interval */
            up = p - 1;  /* tail call for [lo .. p - 1]  (lower interval) */
        }
        if ((up - lo) / 128 > n) /* partition too imbalanced? */
            rnd = l_randomizePivot();  /* try a new randomization */
    }  /* tail call auxsort(L, lo, up, rnd) */
};

/*
** Recognise the exact bytecode emitted for
**     function(a, b) return a < b end
**. This is intentionally narrow: all other comparators continue through
** the Lua call path, preserving full metamethod and side-effect semantics.
*/
const isSimpleLessComparator = function(L) {
    const comparatorIndex = L.ci.funcOff + 2;
    const comparator = L.stack[comparatorIndex];
    if (!comparator || !comparator.ttisLclosure()) return false;
    const closure = comparator.value;
    const proto = closure.p;
    if (!proto || closure.nupvalues !== 0 || proto.numparams !== 2 ||
        proto.is_vararg || proto.code.length !== 6) return false;
    const code = proto.code;
    return code[0].opcode === OpCodesI.OP_LT && code[0].A === 1 &&
        code[0].B === 0 && code[0].C === 1 &&
        code[1].opcode === OpCodesI.OP_JMP && code[1].sBx === 1 &&
        code[2].opcode === OpCodesI.OP_LOADBOOL && code[2].A === 2 &&
        code[2].B === 0 && code[2].C === 1 &&
        code[3].opcode === OpCodesI.OP_LOADBOOL && code[3].A === 2 &&
        code[3].B === 1 && code[3].C === 0 &&
        code[4].opcode === OpCodesI.OP_RETURN && code[4].A === 2 &&
        code[4].B === 2 && code[5].opcode === OpCodesI.OP_RETURN &&
        code[5].A === 0 && code[5].B === 1;
};

/*
** Sort dense numeric arrays without re-entering the Lua VM for every
** comparison. The values are copied as TValue objects, so the optimisation
** never exposes mutable stack slots to JavaScript's sort implementation.
*/
const sortNumericFast = function(L, n, raw) {
    const values = new Array(n);
    const base = L.top;
    for (let i = 1; i <= n; i++) {
        getitem(L, raw, i);
        const value = L.stack[L.top - 1];
        if (!value || !value.ttisnumber()) {
            L.top = base;
            return false;
        }
        values[i - 1] = new lobject.TValue(value.type, value.value);
        lua_pop(L, 1);
    }

    values.sort((a, b) => {
        if (lvm.luaV_lessthan(L, a, b)) return -1;
        if (lvm.luaV_lessthan(L, b, a)) return 1;
        return 0;
    });

    for (let i = 1; i <= n; i++) {
        lobject.pushobj2s(L, values[i - 1]);
        if (raw) lua_rawseti(L, 1, i);
        else lua_seti(L, 1, i);
    }
    L.top = base;
    return true;
};

const sort = function(L) {
    const raw = has_raw_rw(L, 1);
    let n = aux_getn(L, 1, TAB_RW);
    if (n > 1) {  /* non-trivial interval? */
        luaL_argcheck(L, n < LUA_MAXINTEGER, 1, "array too big");
        if (!lua_isnoneornil(L, 2))  /* is there a 2nd argument? */
            luaL_checktype(L, 2, LUA_TFUNCTION);  /* must be a function */
        lua_settop(L, 2);  /* make sure there are two arguments */
        if ((lua_isnil(L, 2) || isSimpleLessComparator(L)) &&
            raw && sortNumericFast(L, n, true))
            return 0;
        auxsort(L, 1, n, 0, raw);
    }
    return 0;
};

const tab_funcs = {
    "concat": tconcat,
    "insert": tinsert,
    "move":   tmove,
    "pack":   pack,
    "remove": tremove,
    "sort":   sort,
    "unpack": unpack
};

const luaopen_table = function(L) {
    luaL_newlib(L, tab_funcs);
    return 1;
};

module.exports.luaopen_table = luaopen_table;
