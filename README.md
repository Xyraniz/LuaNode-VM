# LuaNode-VM

LuaNode-VM implementa la máquina virtual y las bibliotecas estándar de Lua 5.3 en JavaScript. Se puede usar desde Node.js o mediante el punto de entrada de la CLI; el proyecto conserva la arquitectura de Fengari y corrige áreas concretas de semántica, compatibilidad y pruebas.

## Diferencias que cubre

El runtime presta atención a los enteros con signo de 64 bits. Usa `Number` en el camino seguro y `BigInt` cuando hace falta, normaliza las operaciones a reglas de complemento a dos y evita que claves como `2^53` y `2^53 + 1` colisionen. También incluye correcciones y pruebas para tablas, bibliotecas estándar, I/O de Node.js, bytecode y diagnósticos.

```lua
print(math.maxinteger)
print(math.mininteger)
print(9007199254740993)
```

## Instalación y uso

```bash
npm install
npm test
node cli/luanode.js -e "print(math.maxinteger)"
```

La API principal está en `src/luanode.js` y la CLI en `cli/luanode.js`. `npm run lint`, `npm run coverage` y `npm run benchmark` cubren tareas habituales de desarrollo.

## Verificación y procedencia

`tests/` contiene las regresiones del proyecto y `conformance/` conserva los artefactos de la suite oficial de Lua 5.3. El repositorio deriva de la arquitectura de Fengari; la atribución, el alcance de los cambios y la licencia MIT están documentados en `README.md` y `LICENSE`.
