let wasm_bindgen;
(function() {
    const __exports = {};
    let script_src;
    if (typeof document !== 'undefined' && document.currentScript !== null) {
        script_src = new URL(document.currentScript.src, location.href).toString();
    }
    let wasm = undefined;

    const cachedTextDecoder = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : { decode: () => { throw Error('TextDecoder not available') } } );

    if (typeof TextDecoder !== 'undefined') { cachedTextDecoder.decode(); };

    let cachedUint8ArrayMemory0 = null;

    function getUint8ArrayMemory0() {
        if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
            cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
        }
        return cachedUint8ArrayMemory0;
    }

    function getStringFromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
    }

    let WASM_VECTOR_LEN = 0;

    const cachedTextEncoder = (typeof TextEncoder !== 'undefined' ? new TextEncoder('utf-8') : { encode: () => { throw Error('TextEncoder not available') } } );

    const encodeString = (typeof cachedTextEncoder.encodeInto === 'function'
        ? function (arg, view) {
        return cachedTextEncoder.encodeInto(arg, view);
    }
        : function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    });

    function passStringToWasm0(arg, malloc, realloc) {

        if (realloc === undefined) {
            const buf = cachedTextEncoder.encode(arg);
            const ptr = malloc(buf.length, 1) >>> 0;
            getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
            WASM_VECTOR_LEN = buf.length;
            return ptr;
        }

        let len = arg.length;
        let ptr = malloc(len, 1) >>> 0;

        const mem = getUint8ArrayMemory0();

        let offset = 0;

        for (; offset < len; offset++) {
            const code = arg.charCodeAt(offset);
            if (code > 0x7F) break;
            mem[ptr + offset] = code;
        }

        if (offset !== len) {
            if (offset !== 0) {
                arg = arg.slice(offset);
            }
            ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
            const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
            const ret = encodeString(arg, view);

            offset += ret.written;
            ptr = realloc(ptr, len, offset, 1) >>> 0;
        }

        WASM_VECTOR_LEN = offset;
        return ptr;
    }

    let cachedFloat32ArrayMemory0 = null;

    function getFloat32ArrayMemory0() {
        if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
            cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
        }
        return cachedFloat32ArrayMemory0;
    }

    function getArrayF32FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
    }

    function takeFromExternrefTable0(idx) {
        const value = wasm.__wbindgen_export_0.get(idx);
        wasm.__externref_table_dealloc(idx);
        return value;
    }

    let cachedFloat64ArrayMemory0 = null;

    function getFloat64ArrayMemory0() {
        if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
            cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
        }
        return cachedFloat64ArrayMemory0;
    }

    function getArrayF64FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
    }

    let cachedInt32ArrayMemory0 = null;

    function getInt32ArrayMemory0() {
        if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
            cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
        }
        return cachedInt32ArrayMemory0;
    }

    function getArrayI32FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
    }

    const SolverFinalization = (typeof FinalizationRegistry === 'undefined')
        ? { register: () => {}, unregister: () => {} }
        : new FinalizationRegistry(ptr => wasm.__wbg_solver_free(ptr >>> 0, 1));

    class Solver {

        __destroy_into_raw() {
            const ptr = this.__wbg_ptr;
            this.__wbg_ptr = 0;
            SolverFinalization.unregister(this);
            return ptr;
        }

        free() {
            const ptr = this.__destroy_into_raw();
            wasm.__wbg_solver_free(ptr, 0);
        }
        /**
         * [equity, EV] of one hand for `player` at the current node (NaN if not in range).
         * @param {number} player
         * @param {string} hand
         * @returns {Float32Array}
         */
        hand_values(player, hand) {
            const ptr0 = passStringToWasm0(hand, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.solver_hand_values(this.__wbg_ptr, player, ptr0, len0);
            var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v2;
        }
        /**
         * @returns {boolean}
         */
        is_terminal() {
            const ret = wasm.solver_is_terminal(this.__wbg_ptr);
            return ret !== 0;
        }
        back_to_root() {
            wasm.solver_back_to_root(this.__wbg_ptr);
        }
        /**
         * Strategy of the current player for one hand: one frequency per action. Empty if the hand is not in range.
         * @param {string} hand
         * @returns {Float32Array}
         */
        hand_strategy(hand) {
            const ptr0 = passStringToWasm0(hand, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.solver_hand_strategy(this.__wbg_ptr, ptr0, len0);
            var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v2;
        }
        /**
         * @returns {number}
         */
        current_player() {
            const ret = wasm.solver_current_player(this.__wbg_ptr);
            return ret >>> 0;
        }
        /**
         * Range-wide frequency of each action for the current player.
         * @returns {Float32Array}
         */
        range_strategy() {
            const ret = wasm.solver_range_strategy(this.__wbg_ptr);
            var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v1;
        }
        /**
         * EV of each action for one hand of the current player.
         * @param {string} hand
         * @returns {Float32Array}
         */
        hand_action_evs(hand) {
            const ptr0 = passStringToWasm0(hand, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.solver_hand_action_evs(this.__wbg_ptr, ptr0, len0);
            var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v2;
        }
        /**
         * board: "Td9d6h" (3 to 5 cards). sizes: "33%, 75%" style strings (PioSOLVER-like).
         * @param {string} oop_range
         * @param {string} ip_range
         * @param {string} board
         * @param {number} pot
         * @param {number} stack
         * @param {string} flop_bet
         * @param {string} flop_raise
         * @param {string} turn_bet
         * @param {string} turn_raise
         * @param {string} river_bet
         * @param {string} river_raise
         */
        constructor(oop_range, ip_range, board, pot, stack, flop_bet, flop_raise, turn_bet, turn_raise, river_bet, river_raise) {
            const ptr0 = passStringToWasm0(oop_range, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(ip_range, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(board, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passStringToWasm0(flop_bet, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len3 = WASM_VECTOR_LEN;
            const ptr4 = passStringToWasm0(flop_raise, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len4 = WASM_VECTOR_LEN;
            const ptr5 = passStringToWasm0(turn_bet, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len5 = WASM_VECTOR_LEN;
            const ptr6 = passStringToWasm0(turn_raise, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len6 = WASM_VECTOR_LEN;
            const ptr7 = passStringToWasm0(river_bet, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len7 = WASM_VECTOR_LEN;
            const ptr8 = passStringToWasm0(river_raise, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len8 = WASM_VECTOR_LEN;
            const ret = wasm.solver_new(ptr0, len0, ptr1, len1, ptr2, len2, pot, stack, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7, ptr8, len8);
            if (ret[2]) {
                throw takeFromExternrefTable0(ret[1]);
            }
            this.__wbg_ptr = ret[0] >>> 0;
            SolverFinalization.register(this, this.__wbg_ptr, this);
            return this;
        }
        /**
         * Run `n` more iterations and return the exploitability (in chips).
         * @param {number} n
         * @returns {number}
         */
        run(n) {
            const ret = wasm.solver_run(this.__wbg_ptr, n);
            return ret;
        }
        /**
         * Deal a turn/river card at a chance node ("7s").
         * @param {string} card
         */
        deal(card) {
            const ptr0 = passStringToWasm0(card, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.solver_deal(this.__wbg_ptr, ptr0, len0);
            if (ret[1]) {
                throw takeFromExternrefTable0(ret[0]);
            }
        }
        /**
         * @param {number} action
         */
        play(action) {
            wasm.solver_play(this.__wbg_ptr, action);
        }
        /**
         * Available actions as "Check|Bet:120|AllIn:900|Fold|Call|Raise:300"
         * @returns {string}
         */
        actions() {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.solver_actions(this.__wbg_ptr);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * @param {boolean} compressed
         */
        allocate(compressed) {
            wasm.solver_allocate(this.__wbg_ptr, compressed);
        }
        finalize() {
            wasm.solver_finalize(this.__wbg_ptr);
        }
        /**
         * Reach-weighted range of `player` at the current node as "AhKh:0.370,..." (max weight scaled to 1).
         * Used to chain streets: the turn solve starts from the ranges that actually reach the turn.
         * @param {number} player
         * @returns {string}
         */
        range_at(player) {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.solver_range_at(this.__wbg_ptr, player);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * @returns {boolean}
         */
        is_chance() {
            const ret = wasm.solver_is_chance(this.__wbg_ptr);
            return ret !== 0;
        }
        /**
         * Memory needed in MB: [uncompressed, compressed]
         * @returns {Float64Array}
         */
        memory_mb() {
            const ret = wasm.solver_memory_mb(this.__wbg_ptr);
            var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
            return v1;
        }
        /**
         * @returns {Int32Array}
         */
        total_bet() {
            const ret = wasm.solver_total_bet(this.__wbg_ptr);
            var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v1;
        }
    }
    __exports.Solver = Solver;

    async function __wbg_load(module, imports) {
        if (typeof Response === 'function' && module instanceof Response) {
            if (typeof WebAssembly.instantiateStreaming === 'function') {
                try {
                    return await WebAssembly.instantiateStreaming(module, imports);

                } catch (e) {
                    if (module.headers.get('Content-Type') != 'application/wasm') {
                        console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                    } else {
                        throw e;
                    }
                }
            }

            const bytes = await module.arrayBuffer();
            return await WebAssembly.instantiate(bytes, imports);

        } else {
            const instance = await WebAssembly.instantiate(module, imports);

            if (instance instanceof WebAssembly.Instance) {
                return { instance, module };

            } else {
                return instance;
            }
        }
    }

    function __wbg_get_imports() {
        const imports = {};
        imports.wbg = {};
        imports.wbg.__wbindgen_init_externref_table = function() {
            const table = wasm.__wbindgen_export_0;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
            ;
        };
        imports.wbg.__wbindgen_string_new = function(arg0, arg1) {
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        };
        imports.wbg.__wbindgen_throw = function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        };

        return imports;
    }

    function __wbg_init_memory(imports, memory) {

    }

    function __wbg_finalize_init(instance, module) {
        wasm = instance.exports;
        __wbg_init.__wbindgen_wasm_module = module;
        cachedFloat32ArrayMemory0 = null;
        cachedFloat64ArrayMemory0 = null;
        cachedInt32ArrayMemory0 = null;
        cachedUint8ArrayMemory0 = null;


        wasm.__wbindgen_start();
        return wasm;
    }

    function initSync(module) {
        if (wasm !== undefined) return wasm;


        if (typeof module !== 'undefined') {
            if (Object.getPrototypeOf(module) === Object.prototype) {
                ({module} = module)
            } else {
                console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
            }
        }

        const imports = __wbg_get_imports();

        __wbg_init_memory(imports);

        if (!(module instanceof WebAssembly.Module)) {
            module = new WebAssembly.Module(module);
        }

        const instance = new WebAssembly.Instance(module, imports);

        return __wbg_finalize_init(instance, module);
    }

    async function __wbg_init(module_or_path) {
        if (wasm !== undefined) return wasm;


        if (typeof module_or_path !== 'undefined') {
            if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
                ({module_or_path} = module_or_path)
            } else {
                console.warn('using deprecated parameters for the initialization function; pass a single object instead')
            }
        }

        if (typeof module_or_path === 'undefined' && typeof script_src !== 'undefined') {
            module_or_path = script_src.replace(/\.js$/, '_bg.wasm');
        }
        const imports = __wbg_get_imports();

        if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
            module_or_path = fetch(module_or_path);
        }

        __wbg_init_memory(imports);

        const { instance, module } = await __wbg_load(await module_or_path, imports);

        return __wbg_finalize_init(instance, module);
    }

    wasm_bindgen = Object.assign(__wbg_init, { initSync }, __exports);

})();
