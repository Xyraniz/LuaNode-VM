-- Test: string literals of various lengths with escapes
local s1 = "short"
local s2 = "this is a string that is definitely longer than thirty two characters"
local s3 = "escape test: \\n \\t \\\\ \"quotes\" and a very long continuation to be safe beyond 32"
local s4 = string.rep("a", 5000)
local s5 = "x"
for i = 1, 200 do s5 = s5 .. "y" end

print("s1:", s1)
print("s2 len:", #s2)
print("s3:", s3)
print("s4 len:", #s4)
print("s5 len:", #s5)

-- long comment
local long = [[
this is a long bracket string
with multiple lines
and it should work fine even though it is way over 32 chars
]]
print("long comment len:", #long)

-- error message with long string (this used to crash)
local ok, err = pcall(function()
    error("this is a very long error message that exceeds thirty two characters and would crash the old lexer")
end)
print("pcall ok:", ok)
print("err:", err)
