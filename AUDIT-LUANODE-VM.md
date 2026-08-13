# Auditoría y mejora de LuaNode-VM

## Conclusión ejecutiva

**Sí, LuaNode-VM es mejorable, y ya dejé implementada una mejora de alto impacto.** La dirección correcta no es intentar convertirlo ahora en Luau completo. LuaNode-VM tiene una ventaja clara si se posiciona como un runtime Lua 5.3 para JavaScript con **enteros signed int64 exactos, semántica de tablas/GC más completa y conformance reproducible**. Fengari, por su propia documentación, utiliza una configuración de enteros de 32 bits, depende del recolector de JavaScript y declara ausentes varias capacidades de GC, weak tables, finalizadores e I/O [1].

Luau no es una “versión rápida de Lua 5.3” que pueda activarse con una bandera. Está basado en Lua 5.1, tiene parser, compilador multietapa, bytecode e intérprete propios, además de un modelo de sandbox y extensiones de lenguaje diferentes [2] [3] [4]. Su documentación también indica que no adopta los enteros de 64 bits ni los operadores bitwise de Lua 5.3 como características de primera clase [3]. Por eso, mezclar Luau dentro del parser actual produciría una dialecto ambiguo, no compatibilidad real.

> **Recomendación:** conservar LuaNode-VM como runtime Lua 5.3 exacto y, si Luau se vuelve requisito de producto, añadirlo como backend/frontend separado detrás de una API explícita. No conviene sacrificar la identidad técnica de LuaNode-VM por una compatibilidad parcial con Luau.

## Cambios implementados

| Área | Cambio | Efecto esperado |
|---|---|---|
| `table.sort` | Fast path para arrays densos numéricos, con lectura/escritura directa de tabla y comparación numérica sin reentrada en la VM. | Gran aceleración en `table.sort(t)` sobre arrays numéricos; se conserva el camino general para comparadores personalizados y metatables. |
| Aritmética int64 | Hot path de `add`, `sub`, `mul` y `neg` que evita conversiones a `BigInt` cuando ambos operandos y el resultado caben de forma segura. | Menor coste en aritmética entera común sin cambiar el comportamiento de overflow int64. |
| Identidad del paquete | Nuevo entrypoint `src/luanode.js`; `package.json` lo publica como `main` y `module`; `src/fengari.js` continúa disponible como compatibilidad heredada. | Los consumidores nuevos ya no dependen del nombre histórico de Fengari, sin romper la API C-shaped existente. |
| Regresiones | Nuevas pruebas para arrays enteros, valores int64 por encima de `2^53`, mezcla entero/float, comparadores personalizados y entrypoint público. | La suite crece a 7 suites y 154 tests. |
| Benchmark | Nuevo `bench/runtime.lua` y comando `npm run benchmark`. | Permite medir aritmética, indexing de tablas, acceso a campos, llamadas Lua y ordenación. |
| Documentación | README actualizado con el posicionamiento frente a Luau, el método de benchmark y el entrypoint canónico. | Evita promesas vagas y hace reproducibles las afirmaciones técnicas. |

## Rendimiento observado

La comparación se ejecutó en el mismo sandbox con Node.js `v22.13.0`, cinco ejecuciones por runtime y la mediana de cada benchmark. Fengari se instaló como `fengari@0.1.5` y `fengari-node-cli@0.1.0`. La revisión base corresponde al commit original del repositorio antes de estos cambios.

| Benchmark | LuaNode-VM base (ms) | LuaNode-VM mejorado (ms) | Fengari (ms) | Cambio contra base | Mejorado frente a Fengari |
|---|---:|---:|---:|---:|---:|
| `arith` | 213.630 | 211.141 | 149.846 | -1.2% | 1.41× más lento |
| `table_index` | 30.041 | 28.922 | 24.948 | -3.7% | 1.16× más lento |
| `field_access` | 70.118 | 70.326 | 56.080 | +0.3% | 1.25× más lento |
| `lua_calls` | 140.812 | 145.279 | 102.574 | +3.2% | 1.42× más lento |
| `table_sort` | 599.116 | 37.872 | 118.045 | **-93.7%** | **3.12× más rápido** |

La cifra más importante es `table.sort`: el nuevo camino es aproximadamente **15.8× más rápido que la revisión base** y aproximadamente **3.1× más rápido que Fengari** en este workload. No debe interpretarse como una victoria universal: en aritmética, accesos y llamadas Lua, Fengari sigue siendo más rápido en esta medición. La conclusión honesta es que ya existe un caso de uso concreto donde LuaNode-VM supera a Fengari, mientras que la ventaja de compatibilidad —int64 exacto, GC observable, weak tables, finalizadores, I/O y bytecode— sigue siendo el diferenciador principal.

## Validación realizada

La suite funcional final pasó **7 suites y 154 tests**. ESLint terminó con **0 errores**; el repositorio todavía conserva warnings heredados de estilo, por lo que no presento lint limpio como si lo fuera. La suite oficial portable de Lua 5.3 también terminó con `final OK !!!` después de ejecutar el launcher `all.lua` sobre la copia extraída del archivo de conformance. El árbol versionado de la suite fue restaurado después de esa prueba para que el diff solo contenga cambios intencionales.

Los comandos principales son:

```bash
npm test -- --runInBand
npm run lint
npm run benchmark
```

Para la verificación oficial portable, el README conserva el procedimiento del repositorio:

```bash
cd conformance/lua-5.3.0-tests
node --expose-gc ../../cli/luanode.js \
  -e '_U=true; dofile("run_all.lua")'
```

## ¿Qué haría después?

La siguiente mejora de alto valor sería un **perfil de rendimiento continuo**, no una reescritura total. Conviene añadir benchmarks de acceso a campos constantes, `pairs`/`ipairs`, creación de closures, `pcall`, concatenación y llamadas a builtins; después, incorporar comparaciones contra la revisión base en CI con umbrales tolerantes para detectar regresiones.

En el núcleo, las oportunidades más prometedoras son un almacenamiento híbrido de arrays numéricos más cercano a un fast array, cachés de acceso para campos constantes sin metatables y especialización de builtins frecuentes. Estas mejoras deben protegerse con pruebas de metamétodos, weak tables y claves int64; optimizar LuaNode-VM no significa eliminar las semánticas que lo diferencian.

Para Luau, la ruta sensata sería un paquete separado o un adaptador opcional. La integración debería tener una interfaz clara para seleccionar `lua53` o `luau`, loaders de bytecode separados y pruebas de compatibilidad independientes. No recomendaría empezar por un preprocesador de sintaxis: permitiría aparentar soporte de Luau sin implementar sus semánticas, su bytecode ni su modelo de rendimiento.

## Referencias

[1]: https://github.com/fengari-lua/fengari/blob/master/README.md "Fengari README oficial: semántica, enteros y funciones ausentes"
[2]: https://github.com/luau-lang/luau "Repositorio oficial de Luau"
[3]: https://luau.org/compatibility "Compatibilidad de Luau con Lua"
[4]: https://luau.org/syntax "Sintaxis de Luau por ejemplos"
[5]: https://luau.org/performance "Cómo Luau consigue rendimiento"
[6]: https://www.lua.org/manual/5.3/manual.html "Manual de referencia de Lua 5.3"
