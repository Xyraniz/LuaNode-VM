_U = true
_soft = true
_port = true
_nomsg = true
local ok, err = pcall(dofile, "strings.lua")
print("STRINGS_RESULT", ok, type(err), tostring(err))
