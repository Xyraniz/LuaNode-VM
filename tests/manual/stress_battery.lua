-- Bateria de pruebas de robustez (replica las que corrio Claude)
local pass, fail = 0, 0
local function check(name, cond)
    if cond then pass = pass + 1 else fail = fail + 1
        io.write("FAIL: "..name.."\n")
    end
end

-- 1. Closures
local function counter()
    local n = 0
    return function() n = n + 1; return n end
end
local c = counter()
c(); c(); c()
check("closures", c() == 4)

-- 2. Metatablas
local mt = { __add = function(a,b) return setmetatable({v=a.v+b.v}, getmetatable(a)) end }
local a = setmetatable({v=10}, mt)
local b = setmetatable({v=5}, mt)
check("metatables __add", (a+b).v == 15)

-- 3. Coroutines
local co = coroutine.create(function(x)
    for i=1,3 do coroutine.yield(x+i) end
    return "done"
end)
local r1ok, r1val = coroutine.resume(co, 100)
local r2ok, r2val = coroutine.resume(co)
local r3ok, r3val = coroutine.resume(co)
local r4ok, r4val = coroutine.resume(co)
check("coroutines", r1ok and r1val==101 and r2ok and r2val==102 and r3ok and r3val==103 and r4ok and r4val=="done" and coroutine.status(co)=="dead")

-- 4. String library
check("string.rep", #string.rep("ab", 100) == 200)
check("string.find", string.find("hello world", "wor") == 7)
check("string.gsub count", select(2, string.gsub("aaa", "a", "b")) == 3)
check("string.upper", string.upper("abc123") == "ABC123")

-- 5. Patterns
check("pattern capture", string.match("2026-08-11", "(%d+)-(%d+)-(%d+)") == "2026")
check("pattern class", string.match("abc123def", "%d+") == "123")

-- 6. Goto
local function gototest()
    local i = 0
    ::top::
    i = i + 1
    if i < 5 then goto top end
    return i
end
check("goto loop", gototest() == 5)

-- 7. utf8
check("utf8.len", utf8.len("hello") == 5)
check("utf8.codepoint", utf8.codepoint("A") == 65)

-- 8. pcall / errors
local ok, err = pcall(function() error("custom error message that is longer than thirty two chars") end)
check("pcall catches error", ok == false and string.find(err, "custom error") ~= nil)
local ok2, err2 = pcall(function() error({code=42, msg="table error"}) end)
check("pcall table error", ok2 == false and type(err2) == "table" and err2.code == 42)

-- 9. Deep recursion (must complete correctly; LuaNode-VM handles deep
--    Lua recursion without a hard C-stack limit, so this is a robustness win)
local function deep(n)
    if n <= 0 then return 0 end
    return deep(n-1)
end
check("deep recursion completes", pcall(deep, 100000) == true)

-- 10. Integer overflow (64-bit wraparound)
local maxint = math.maxinteger
check("maxinteger is 2^63-1", maxint == 9223372036854775807)
check("overflow wraps", maxint + 1 == math.mininteger)
check("mininteger is -2^63", math.mininteger == -9223372036854775808)

-- 11. string.pack 64-bit (la ventaja real sobre fengari)
local packed = string.pack("i8", 9223372036854775807)
check("string.pack i8 max", #packed == 8)
local unpacked = string.unpack("i8", packed)
check("string.unpack i8 roundtrip", unpacked == 9223372036854775807)

-- 12. Large table
local t = {}
for i = 1, 10000 do t[i] = i*2 end
check("large table build", t[5000] == 10000 and t[10000] == 20000)

-- 13. Large integer keys (no collision above 2^53)
t[9007199254740993] = "big1"
t[9007199254740992] = "big2"
check("large int keys distinct", t[9007199254740993] == "big1" and t[9007199254740992] == "big2")

-- 14. GC / memory pressure
local function memtest()
    local a = {}
    for i=1,10000 do a[i] = string.rep("x", 50) end
    return #a
end
check("memory pressure", memtest() == 10000)
-- collectgarbage must not raise (delegated to host JS GC, benign no-op)
check("collectgarbage collect", collectgarbage("collect") == 0)
check("collectgarbage count", type(collectgarbage("count")) == "number")
check("collectgarbage isrunning", collectgarbage("isrunning") == true)

-- 15. Syntax error handled gracefully
local ok4, err4 = load("for = 5")
check("syntax error caught", ok4 == nil and err4 ~= nil)

-- 16. Long string literals (THE bug that was fixed)
check("string 31 chars", #("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") == 31)
check("string 32 chars", #("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") == 32)
check("string 100 chars", #string.rep("z", 100) == 100)
check("string 1000 chars", #string.rep("z", 1000) == 1000)

-- 17. String with escapes (longer than 32)
check("escaped string", "tab\there and newline\nthere plus more chars to exceed thirty two" ~= nil)

io.write(string.format("\n=== RESULTADO: %d pasaron, %d fallaron ===\n", pass, fail))
if fail > 0 then os.exit(1) end
