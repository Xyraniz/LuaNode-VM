
const {
    constant_types: {
        LUA_TBOOLEAN,
        LUA_TCCL,
        LUA_TLCF,
        LUA_TLCL,
        LUA_TLIGHTUSERDATA,
        LUA_TLNGSTR,
        LUA_TNIL,
        LUA_TNUMFLT,
        LUA_TNUMINT,
        LUA_TSHRSTR,
        LUA_TTABLE,
        LUA_TTHREAD,
        LUA_TUSERDATA
    },
    to_jsstring,
    to_luastring
} = require('../defs.js');
const {
    LUA_MAXINTEGER
} = require('../luaconf.js');
const { lua_assert } = require('./llimits.js');
const I64 = require('./lint64.js');
const allTables = new Set();
let allocationsSinceCollection = 0;
let instructionsSinceCollection = 0;
let simulatedMemoryKb = 1;
let gcRunning = true;
let collecting = false;
const ldebug  = require('./ldebug.js');
const lobject = require('./lobject.js');
const {
    luaS_bless,
    luaS_hashlongstr,
    TString
} = require('./lstring.js');
const lstate  = require('./lstate.js');

/* used to prevent conflicts with lightuserdata keys */
let lightuserdata_hashes = new WeakMap();
const get_lightuserdata_hash = function(v) {
    let hash = lightuserdata_hashes.get(v);
    if (!hash) {
        /* Hash should be something unique that is a valid WeakMap key
           so that it ends up in dead_weak when removed from a table */
        hash = {};
        lightuserdata_hashes.set(v, hash);
    }
    return hash;
};

const float_key_integer = function(n) {
    const asInt = I64.fromFloat(n, 0);
    if (asInt !== null) return asInt;
    /* Number(math.maxinteger) rounds to 2^63, but Lua compares that
       float equal to the largest signed integer. */
    if (n === Math.pow(2, 63)) return I64.MAX_INT64;
    if (n === -Math.pow(2, 63)) return I64.MIN_INT64;
    return null;
};

const table_hash = function(L, key) {
    switch(key.type) {
        case LUA_TNIL:
            return ldebug.luaG_runerror(L, to_luastring("table index is nil", true));
        case LUA_TNUMFLT: {
            if (isNaN(key.value))
                return ldebug.luaG_runerror(L, to_luastring("table index is NaN", true));
            const integerKey = float_key_integer(key.value);
            return integerKey === null ? key.value : integerKey;
        }
        case LUA_TNUMINT:
        case LUA_TBOOLEAN:
        case LUA_TTABLE:
        case LUA_TLCL:
        case LUA_TLCF:
        case LUA_TCCL:
        case LUA_TUSERDATA:
        case LUA_TTHREAD:
            return key.value;
        case LUA_TSHRSTR:
        case LUA_TLNGSTR:
            return luaS_hashlongstr(key.tsvalue());
        case LUA_TLIGHTUSERDATA: {
            let v = key.value;
            switch(typeof v) {
                case "string":
                    /* possible conflict with LUA_TSTRING.
                       prefix this string with "*" so they don't clash */
                    return "*" + v;
                case "number":
                    /* possible conflict with LUA_TNUMBER. turn into string
                       and prefix with "#" to avoid clash with other strings */
                    return "#" + v;
                case "boolean":
                    /* possible conflict with LUA_TBOOLEAN. use strings
                       ?true and ?false instead */
                    return v ? "?true" : "?false";
                case "function":
                    /* possible conflict with LUA_TLCF. indirect via a weakmap */
                    return get_lightuserdata_hash(v);
                case "object":
                    /* v could be a lua_State, CClosure, LClosure, Table or
                       Userdata from this state as returned by lua_topointer */
                    if ((v instanceof lstate.lua_State && v.l_G === L.l_G) ||
                        v instanceof Table ||
                        v instanceof lobject.Udata ||
                        v instanceof lobject.LClosure ||
                        v instanceof lobject.CClosure) {
                        /* indirect via a weakmap */
                        return get_lightuserdata_hash(v);
                    }
                    /* fall through */
                default:
                    return v;
            }
        }
        default:
            throw new Error("unknown key type: " + key.type);
    }
};

class Table {
    constructor(L) {
        this.id = L.l_G.id_counter++;
        this.strong = new Map();
        this.weakKeys = new WeakMap();
        this.dead_strong = new Map();
        this.dead_weak = void 0; /* initialised when needed */
        this.f = void 0; /* first entry */
        this.l = void 0; /* last entry */
        this.metatable = null;
        this.weakMode = "";
        this.finalized = false;
        this.finalizerPending = false;
        this.flags = ~0;
        allTables.add(this);
    }
}

const invalidateTMcache = function(t) {
    t.flags = 0;
};

const add = function(t, hash, key, value) {
    t.dead_strong.clear();
    t.dead_weak = void 0;
    let prev = null;
    let entry = {
        key: key,
        value: value,
        hash: hash,
        keyRef: void 0,
        valueRef: void 0,
        weakKey: false,
        weakValue: false,
        p: prev = t.l,
        n: void 0,
        live: true
    };
    if (!t.f) t.f = entry;
    if (prev) prev.n = entry;
    t.l = entry;
    storeEntry(t, entry);
};

const is_valid_weakmap_key = function(k) {
    return typeof k === 'object' ? k !== null : typeof k === 'function';
};

const is_collectable = function(value) {
    /* Interned Lua strings remain valid weak-table keys/values for the
       purposes of Lua 5.3's weak-table semantics. */
    return is_valid_weakmap_key(value) && !(value instanceof TString);
};
const unlinkEntry = function(t, entry) {
    let next = entry.n;
    let prev = entry.p;
    if (prev) prev.n = next;
    if (next) next.p = prev;
    if (t.f === entry) t.f = next;
    if (t.l === entry) t.l = prev;
    entry.p = void 0;
    entry.n = void 0;
    entry.live = false;
};

const removeEntry = function(t, entry) {
    if (!entry.live) return;
    if (entry.weakKey) {
        const key = entry.keyRef ? entry.keyRef.deref() : entry.key.value;
        if (key !== void 0 && key !== null) t.weakKeys.delete(key);
    } else {
        t.strong.delete(entry.hash);
    }
    unlinkEntry(t, entry);
};

const materializeKey = function(entry) {
    if (entry.keyRef) {
        const key = entry.keyRef.deref();
        if (key === void 0) return null;
        entry.key.value = key;
    }
    return entry.key;
};

const materializeValue = function(entry) {
    if (entry.valueRef) {
        const value = entry.valueRef.deref();
        if (value === void 0) return null;
        entry.value.value = value;
    }
    return entry.value;
};

const modeForMetatable = function(L, mt) {
    if (!mt) return "";
    const mode = luaH_getstr(mt, luaS_bless(L, to_luastring("__mode", true)));
    return mode.ttisstring() ? to_jsstring(mode.svalue()) : "";
};

const storeEntry = function(t, entry) {
    const key = entry.key.value;
    const value = entry.value.value;
    entry.weakKey = t.weakMode.indexOf("k") !== -1 && is_collectable(key);
    entry.weakValue = t.weakMode.indexOf("v") !== -1 && is_collectable(value);

    entry.keyRef = void 0;
    entry.valueRef = void 0;
    if (entry.weakKey) {
        entry.hash = void 0; /* do not index a weak object through a strong Map key */
        t.weakKeys.set(key, entry);
    } else {
        t.strong.set(entry.hash, entry);
    }

    if (entry.weakValue) {
        /* The simulated Lua collector removes this edge at collection time. */
        entry.valueRef = void 0;
    }
};

/* Rebuild the indexes when a metatable changes a table's weak mode. */
const refreshWeakMode = function(L, t) {
    const mode = modeForMetatable(L, t.metatable);
    if (mode === t.weakMode) return;
    t.weakMode = mode;

    const entries = [];
    for (let entry = t.f; entry;) {
        const next = entry.n;
        const key = materializeKey(entry);
        const value = materializeValue(entry);
        if (key === null || value === null) {
            removeEntry(t, entry);
        } else {
            entry.keyRef = void 0;
            entry.valueRef = void 0;
            entry.key.value = key.value;
            entry.value.value = value.value;
            entries.push(entry);
        }
        entry = next;
    }
    t.strong.clear();
    t.weakKeys = new WeakMap();
    for (const entry of entries) {
        entry.hash = table_hash(L, entry.key);
        storeEntry(t, entry);
    }
};

const getentry = function(t, hash) {
    let entry;
    if (is_valid_weakmap_key(hash)) entry = t.weakKeys.get(hash);
    if (!entry) entry = t.strong.get(hash);
    if (!entry) return null;
    if (materializeKey(entry) === null || materializeValue(entry) === null) {
        removeEntry(t, entry);
        return null;
    }
    return entry;
};

const getgeneric = function(t, hash) {
    const entry = getentry(t, hash);
    return entry ? entry.value : lobject.luaO_nilobject;
};

const luaH_getint = function(t, key) {
    lua_assert(typeof key == "number" && Number.isInteger(key));
    return getgeneric(t, key);
};

const luaH_getstr = function(t, key) {
    lua_assert(key instanceof TString);
    return getgeneric(t, luaS_hashlongstr(key));
};

const luaH_get = function(L, t, key) {
    lua_assert(key instanceof lobject.TValue);
    if (key.ttisnil() || (key.ttisfloat() && isNaN(key.value)))
        return lobject.luaO_nilobject;
    return getgeneric(t, table_hash(L, key));
};

const luaH_setint = function(t, key, value) {
    lua_assert(typeof key == "number" && Number.isInteger(key) && value instanceof lobject.TValue);
    let hash = key; /* table_hash known result */
    if (value.ttisnil()) {
        mark_dead(t, hash);
        return;
    }
    let e = getentry(t, hash);
    if (e) {
        e.valueRef = void 0;
        e.weakValue = false;
        e.value.setfrom(value);
        if (t.weakMode.indexOf("v") !== -1 && is_collectable(value.value)) {
            e.weakValue = true;
        }
    } else {
        let k = new lobject.TValue(LUA_TNUMINT, key);
        let v = new lobject.TValue(value.type, value.value);
        add(t, hash, k, v);
    }
};

const luaH_setfrom = function(L, t, key, value) {
    lua_assert(key instanceof lobject.TValue);
    refreshWeakMode(L, t);
    let hash = table_hash(L, key);
    if (value.ttisnil()) { /* delete */
        mark_dead(t, hash);
        return;
    }

    let e = getentry(t, hash);
    if (e) {
        e.valueRef = void 0;
        e.weakValue = false;
        e.value.setfrom(value);
        if (t.weakMode.indexOf("v") !== -1 && is_collectable(value.value)) {
            e.weakValue = true;
        }
    } else {
        let k;
        let kv = key.value;
        if (key.ttisfloat()) {
            /* Canonicalize integral floats to the same key used by integer
               indices, including the rounded 2^63 boundary. */
            let asInt = float_key_integer(kv);
            if (asInt !== null) {
                k = new lobject.TValue(LUA_TNUMINT, asInt);
            } else {
                k = new lobject.TValue(key.type, kv);
            }
        } else {
            k = new lobject.TValue(key.type, kv);
        }
        let v = new lobject.TValue(value.type, value.value);
        add(t, hash, k, v);
    }
};

const luaH_setmode = function(L, t, mt) {
    t.metatable = mt;
    refreshWeakMode(L, t);
};

/* Move out of 'strong' part and into 'dead' part. */
const mark_dead = function(t, hash) {
    const e = getentry(t, hash);
    if (!e) return;
    if (e.weakKey) {
        removeEntry(t, e);
        return;
    }
    e.key.setdeadvalue();
    e.value.setnilvalue();
    e.valueRef = void 0;
    e.weakValue = false;
    let next = e.n;
    let prev = e.p;
    e.p = void 0; /* no need to know previous item any more */
    if (prev) prev.n = next;
    if (next) next.p = prev;
    if (t.f === e) t.f = next;
    if (t.l === e) t.l = prev;
    e.live = false;
    t.strong.delete(hash);
    if (is_valid_weakmap_key(hash)) {
        if (!t.dead_weak) t.dead_weak = new WeakMap();
        t.dead_weak.set(hash, e);
    } else {
        t.dead_strong.set(hash, e);
    }
};

/*
** Collect Lua-level garbage deterministically. JavaScript keeps the VM's
** object graph alive through ordinary Maps, so weak-table semantics cannot
** be delegated to V8 alone. This pass follows Lua roots and deliberately
** omits weak key/value edges while marking each reachable object.
*/
const needsDeferredFinalization = function(table) {
    for (let entry = table.f; entry; entry = entry.n) {
        if (entry.key && entry.key.type === LUA_TTHREAD) return true;
        if (entry.value && entry.value.type === LUA_TTHREAD) return true;
    }
    return false;
};

const luaH_setrunning = function(running) {
    gcRunning = !!running;
};

const luaH_memory = function() {
    return simulatedMemoryKb;
};

const luaH_maybe_gc = function(L) {
    if (collecting || !gcRunning) return;
    instructionsSinceCollection++;
    if (instructionsSinceCollection >= 10000)
        luaH_collectgarbage(L);
};

const luaH_collectgarbage = function(L) {
    if (collecting) return;
    collecting = true;
    if (typeof console !== "undefined" && process && process.env.LUANODE_GC_DEBUG)
        console.error("GC_START", allTables.size);
    const marked = new Set();
    const visitedTables = new Set();
    let firstFinalizerError = null;

    const markValue = function(type, value) {
        if (value === null || value === void 0) return;
        switch (type) {
            case LUA_TTABLE:
                markTable(value);
                break;
            case LUA_TTHREAD:
                markThread(value);
                break;
            case LUA_TLCL:
                if (marked.has(value)) return;
                marked.add(value);
                if (value.upvals) value.upvals.forEach(markTValue);
                if (value.p) {
                    if (value.p.k) value.p.k.forEach(markTValue);
                    if (value.p.cache) markValue(LUA_TLCL, value.p.cache);
                }
                break;
            case LUA_TCCL:
                if (marked.has(value)) return;
                marked.add(value);
                if (value.upvalue) value.upvalue.forEach(markTValue);
                break;
            case LUA_TUSERDATA:
                if (marked.has(value)) return;
                marked.add(value);
                if (value.metatable) markTable(value.metatable);
                if (value.uservalue) markTValue(value.uservalue);
                break;
            default:
                break;
        }
    };

    const markTValue = function(tv) {
        if (tv && tv.type !== LUA_TNIL && !tv.ttisdeadkey())
            markValue(tv.type, tv.value);
    };

    const markThread = function(thread) {
        if (!thread || marked.has(thread)) return;
        marked.add(thread);
        if (thread.stack) {
            const top = Number.isFinite(thread.top) ? thread.top : thread.stack.length;
            for (let i = 0; i < top; i++) markTValue(thread.stack[i]);
        }
        if (thread.ci && thread.ci.func) markTValue(thread.ci.func);
    };

    const markTable = function(table) {
        if (!table || visitedTables.has(table)) return;
        visitedTables.add(table);
        marked.add(table);
        table.finalizerPending = false;
        if (table.metatable) markTable(table.metatable);
        for (let entry = table.f; entry; entry = entry.n) {
            const key = materializeKey(entry);
            const value = materializeValue(entry);
            if (key && !entry.weakKey) markTValue(key);
            if (value && !entry.weakValue &&
                (!entry.weakKey || marked.has(key.value)))
                markTValue(value);
        }
    };

    markValue(LUA_TTHREAD, L);
    if (L.l_G && L.l_G.l_registry) markTValue(L.l_G.l_registry);
    if (L.l_G && L.l_G.mt) {
        L.l_G.mt.forEach((mt) => { if (mt) markTable(mt); });
    }

    /* Ephemerons may make more objects reachable after their keys are
       marked, so repeat the strong-edge pass to a fixed point. */
    let changed = true;
    while (changed) {
        const before = marked.size;
        for (const table of visitedTables) {
            for (let entry = table.f; entry; entry = entry.n) {
                const key = materializeKey(entry);
                const value = materializeValue(entry);
                if (value && !entry.weakValue && key &&
                    (!entry.weakKey || marked.has(key.value)))
                    markTValue(value);
            }
        }
        changed = marked.size !== before;
    }

    /* Weak references are cleared before finalizers run, matching Lua's
       observable ordering for finalizers that inspect weak tables. */
    for (const table of allTables) {
        for (let entry = table.f; entry;) {
            const next = entry.n;
            const key = materializeKey(entry);
            const value = materializeValue(entry);
            const tableReachable = marked.has(table);
            const deadKey = entry.weakKey && key &&
                (!tableReachable || !marked.has(key.value));
            const deadValue = entry.weakValue && value &&
                (!tableReachable || !marked.has(value.value));
            /* Weak keys of reachable tables survive until finalizers run;
               weak edges in unreachable metatables are cleared immediately. */
            if (deadValue || (deadKey && !tableReachable)) removeEntry(table, entry);
            entry = next;
        }
    }

    const gcName = luaS_bless(L, to_luastring("__gc", true));
    const lapi = require('./lapi.js');
    const ldo = require('./ldo.js');
    const finalizableTables = Array.from(allTables).reverse();
    for (const table of finalizableTables) {
        if (marked.has(table) || table.finalized || !table.metatable) continue;
        const finalizer = luaH_getstr(table.metatable, gcName);
        if (!finalizer.ttisfunction()) continue;
        if (table.metatable.weakMode.indexOf("v") !== -1 &&
            !marked.has(finalizer.value))
            continue;
        if (needsDeferredFinalization(table) && !table.finalizerPending) {
            table.finalizerPending = true;
            continue;
        }
        table.finalized = true;
        table.finalizerPending = false;
        const base = L.top;
        lobject.pushobj2s(L, finalizer);
        lobject.pushobj2s(L, new lobject.TValue(LUA_TTABLE, table));
        if (L.ci.callstatus & lstate.CIST_LUA) {
            try {
                ldo.luaD_callnoyield(L, base, 0);
            } catch (error) {
                /* Errors from an automatic finalizer are isolated from the
                   mutator; an explicit collectgarbage call uses pcall below. */
                L.top = base;
                L.status = 0;
            }
        } else {
            const status = lapi.lua_pcall(L, 1, 0, 0);
            if (status !== 0) {
                if (!firstFinalizerError) {
                    const errorValue = L.stack[L.top - 1];
                    firstFinalizerError = errorValue
                        ? new lobject.TValue(errorValue.type, errorValue.value)
                        : new lobject.TValue(LUA_TNIL, null);
                }
                L.top = base;
            }
        }
    }

    for (const table of allTables) {
        for (let entry = table.f; entry;) {
            const next = entry.n;
            const key = materializeKey(entry);
            const value = materializeValue(entry);
            const deadKey = entry.weakKey && key && !marked.has(key.value);
            const deadValue = entry.weakValue && value && !marked.has(value.value);
            if (deadKey || deadValue) removeEntry(table, entry);
            entry = next;
        }
    }

    for (const table of allTables) {
        if (!marked.has(table) && !table.finalizerPending)
            allTables.delete(table);
    }
    allocationsSinceCollection = 0;
    instructionsSinceCollection = 0;
    simulatedMemoryKb = Math.max(1, visitedTables.size);
    collecting = false;
    if (typeof console !== "undefined" && process && process.env.LUANODE_GC_DEBUG)
        console.error("GC_END", allTables.size, visitedTables.size);
    return firstFinalizerError;
};

/*
** Try to find a boundary in table 't'. A 'boundary' is an integer index
** such that t[i] is non-nil and t[i+1] is nil (and 0 if t[1] is nil).
*/
const luaH_getn = function(t) {
    let i = 0;
    let j = t.strong.size + 1; /* use known size of Map to kick start search */
    /* find 'i' and 'j' such that i is present and j is not */
    while (!(luaH_getint(t, j).ttisnil())) {
        i = j;
        /* overflow guard: if j exceeds half of MAXINTEGER, doubling would overflow. */
        if (j > 0x3FFFFFFFFFFFFFFF) {
            i = 1;
            while (!luaH_getint(t, i).ttisnil()) i++;
            return i - 1;
        }
        j *= 2;
    }
    /* now do a binary search between them */
    while (j - i > 1) {
        let m = Math.floor((i+j)/2);
        if (luaH_getint(t, m).ttisnil()) j = m;
        else i = m;
    }
    return i;
};

const luaH_next = function(L, table, keyI) {
    let keyO = L.stack[keyI];

    let entry;
    if (keyO.type === LUA_TNIL) {
        entry = table.f;
    } else {
        /* First find current key */
        let hash = table_hash(L, keyO);
        entry = getentry(table, hash);
        if (entry) {
            entry = entry.n;
        } else {
            /* Try dead keys */
            entry = (table.dead_weak && table.dead_weak.get(hash)) || table.dead_strong.get(hash);
            if (!entry)
                return ldebug.luaG_runerror(L, to_luastring("invalid key to 'next'"));
            /* Iterate until either out of keys, or until finding a non-dead key */
            do {
                entry = entry.n;
                if (!entry) return false;
            } while (entry.key.ttisdeadkey());
        }
    }

    while (entry) {
        const next = entry.n;
        const key = materializeKey(entry);
        const value = materializeValue(entry);
        if (key !== null && value !== null) break;
        removeEntry(table, entry);
        entry = next;
    }
    if (!entry) return false;
    lobject.setobj2s(L, keyI, materializeKey(entry));
    lobject.setobj2s(L, keyI+1, materializeValue(entry));
    return true;
};

module.exports.invalidateTMcache = invalidateTMcache;
module.exports.luaH_get     = luaH_get;
module.exports.luaH_getint  = luaH_getint;
module.exports.luaH_getn    = luaH_getn;
module.exports.luaH_getstr  = luaH_getstr;
module.exports.luaH_collectgarbage = luaH_collectgarbage;
module.exports.luaH_maybe_gc = luaH_maybe_gc;
module.exports.luaH_setrunning = luaH_setrunning;
module.exports.luaH_memory = luaH_memory;
module.exports.luaH_setfrom = luaH_setfrom;
module.exports.luaH_setint  = luaH_setint;
module.exports.luaH_setmeta = luaH_setmode;
module.exports.luaH_new     = function(L) {
    const table = new Table(L);
    simulatedMemoryKb++;
    allocationsSinceCollection++;
    if (!collecting && gcRunning && allocationsSinceCollection >= 100) {
        try {
            luaH_collectgarbage(L);
        } catch (e) {
            if (typeof console !== "undefined") console.error("LuaNode automatic GC exception", e && e.stack || e);
            throw e;
        }
    }
    return table;
};
module.exports.luaH_next    = luaH_next;
module.exports.Table        = Table;
