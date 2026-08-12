_U = true
_soft = true
_port = true
_nomsg = true
local ok, err = pcall(dofile, "nextvar.lua")
print("NEXTVAR_RESULT", ok, type(err), tostring(err))
