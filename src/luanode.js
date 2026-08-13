/*
** Canonical LuaNode-VM entry point.
**
** The implementation keeps the Fengari-shaped C API for compatibility, but
** package consumers should not need to depend on the historical filename.
** `src/fengari.js` remains available as a legacy compatibility entry point.
*/

"use strict";

module.exports = require("./fengari.js");
