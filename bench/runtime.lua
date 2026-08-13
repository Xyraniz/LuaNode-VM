local function bench(name, repetitions, body)
    local start = os.clock()
    for _ = 1, repetitions do
        body()
    end
    local elapsed = (os.clock() - start) * 1000
    print(string.format("%s %.3f ms", name, elapsed))
end

local sink = 0

bench("arith", 20, function()
    local x = 0
    for i = 1, 100000 do
        x = x + i
    end
    sink = x
end)

local dense = {}
for i = 1, 2000 do
    dense[i] = ((i * 17) % 100003)
end
bench("table_index", 30, function()
    local x = 0
    for i = 1, 2000 do
        x = x + dense[i]
    end
    sink = x
end)

local object = {alpha = 1, beta = 2, gamma = 3, delta = 4}
bench("field_access", 50000, function()
    sink = object.alpha + object.beta + object.gamma + object.delta
end)

local function add(a, b)
    return a + b
end
bench("lua_calls", 20, function()
    local x = 0
    for i = 1, 10000 do
        x = add(x, i)
    end
    sink = x
end)

bench("table_sort", 40, function()
    local values = {}
    for i = 1, 1000 do
        values[i] = ((i * 7919) % 1000003)
    end
    table.sort(values)
    sink = values[1000]
end)

print("sink", sink)
