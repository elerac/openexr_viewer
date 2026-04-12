let wasm;

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

let cachedDataViewMemory0 = null;

function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_export_3.set(idx, obj);
    return idx;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
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

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_export_3.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_export_3.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}
/**
 * Write a single RGB layer to EXR bytes.
 *
 * This is a convenience function for simple single-layer images.
 * No `.free()` call is needed - the result is returned directly.
 *
 * # Arguments
 * * `width` - Image width in pixels
 * * `height` - Image height in pixels
 * * `layer_name` - Layer name (e.g., "normals")
 * * `data` - RGB pixel data as Float32Array, length must be width * height * 3
 * * `precision` - Sample precision (F16, F32, or U32)
 * * `compression` - Compression method
 * @param {number} width
 * @param {number} height
 * @param {string | null | undefined} layer_name
 * @param {Float32Array} data
 * @param {SamplePrecision} precision
 * @param {CompressionMethod} compression
 * @returns {Uint8Array}
 */
export function writeExrRgb(width, height, layer_name, data, precision, compression) {
    var ptr0 = isLikeNone(layer_name) ? 0 : passStringToWasm0(layer_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF32ToWasm0(data, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.writeExrRgb(width, height, ptr0, len0, ptr1, len1, precision, compression);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Initialize panic hook for better error messages in browser console.
 * This is called automatically when the WASM module loads - no need to call manually.
 */
export function init_panic_hook() {
    wasm.init_panic_hook();
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}
/**
 * Read an EXR file expecting RGBA channels.
 *
 * This is an optimized function that reads RGBA data directly into
 * interleaved format. Returns the first valid layer with RGBA channels.
 * @param {Uint8Array} data
 * @returns {ExrSimpleImage}
 */
export function readExrRgba(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.readExrRgba(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ExrSimpleImage.__wrap(ret[0]);
}

/**
 * Write a single RGBA layer to EXR bytes.
 *
 * `data` must have length `width * height * 4`.
 * @param {number} width
 * @param {number} height
 * @param {string | null | undefined} layer_name
 * @param {Float32Array} data
 * @param {SamplePrecision} precision
 * @param {CompressionMethod} compression
 * @returns {Uint8Array}
 */
export function writeExrRgba(width, height, layer_name, data, precision, compression) {
    var ptr0 = isLikeNone(layer_name) ? 0 : passStringToWasm0(layer_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF32ToWasm0(data, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.writeExrRgba(width, height, ptr0, len0, ptr1, len1, precision, compression);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Read an EXR file from bytes.
 * @param {Uint8Array} data
 * @returns {ExrDecoder}
 */
export function readExr(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.readExr(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ExrDecoder.__wrap(ret[0]);
}

/**
 * Read an EXR file expecting RGB channels.
 *
 * This is an optimized function that reads RGB data directly into
 * interleaved format. Returns the first valid layer with RGB channels.
 * @param {Uint8Array} data
 * @returns {ExrSimpleImage}
 */
export function readExrRgb(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.readExrRgb(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ExrSimpleImage.__wrap(ret[0]);
}

/**
 * Compression method for EXR output.
 * @enum {0 | 1 | 2 | 3 | 4 | 5}
 */
export const CompressionMethod = Object.freeze({
    /**
     * No compression - fastest, largest files
     */
    None: 0, "0": "None",
    /**
     * Run-length encoding - fast, good for flat areas
     */
    Rle: 1, "1": "Rle",
    /**
     * ZIP compression (single scanline) - slower, smaller files
     */
    Zip: 2, "2": "Zip",
    /**
     * ZIP compression (16 scanlines) - good balance
     */
    Zip16: 3, "3": "Zip16",
    /**
     * PIZ wavelet compression - best for noisy images
     */
    Piz: 4, "4": "Piz",
    /**
     * PXR24 - optimized for depth buffers (lossy for f32)
     */
    Pxr24: 5, "5": "Pxr24",
});
/**
 * Sample precision for pixel data.
 * @enum {0 | 1 | 2}
 */
export const SamplePrecision = Object.freeze({
    /**
     * 16-bit half float
     */
    F16: 0, "0": "F16",
    /**
     * 32-bit float (default)
     */
    F32: 1, "1": "F32",
    /**
     * 32-bit unsigned integer
     */
    U32: 2, "2": "U32",
});

const ExrDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_exrdecoder_free(ptr >>> 0, 1));
/**
 * Decoder result from reading an EXR file.
 *
 * Contains metadata and pixel data for all layers and channels.
 */
export class ExrDecoder {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ExrDecoder.prototype);
        obj.__wbg_ptr = ptr;
        ExrDecoderFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ExrDecoderFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_exrdecoder_free(ptr, 0);
    }
    /**
     * Number of layers in the image.
     * @returns {number}
     */
    get layerCount() {
        const ret = wasm.exrdecoder_layerCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the name of a layer by index.
     * Returns null for the main/default layer (which has no name).
     * @param {number} index
     * @returns {string | undefined}
     */
    getLayerName(index) {
        const ret = wasm.exrdecoder_getLayerName(this.__wbg_ptr, index);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Get interleaved pixel data for a layer.
     * Returns null if any of the required channels are missing or if the layer index is invalid.
     * Pixels are interleaved in the order specified by the provided channel names.
     * @param {number} layer_index
     * @param {string[]} channel_names
     * @returns {Float32Array | undefined}
     */
    getLayerPixels(layer_index, channel_names) {
        const ptr0 = passArrayJsValueToWasm0(channel_names, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.exrdecoder_getLayerPixels(this.__wbg_ptr, layer_index, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        }
        return v2;
    }
    /**
     * Get the channel names for a layer.
     * @param {number} layer_index
     * @returns {string[]}
     */
    getLayerChannelNames(layer_index) {
        const ret = wasm.exrdecoder_getLayerChannelNames(this.__wbg_ptr, layer_index);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Image width in pixels.
     * @returns {number}
     */
    get width() {
        const ret = wasm.exrdecoder_width(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Image height in pixels.
     * @returns {number}
     */
    get height() {
        const ret = wasm.exrdecoder_height(this.__wbg_ptr);
        return ret >>> 0;
    }
}

const ExrEncoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_exrencoder_free(ptr >>> 0, 1));
/**
 * Encoder for creating multi-layer EXR images.
 *
 * Use this class to construct EXR files with multiple AOV layers
 * (beauty, depth, normals, etc.) from WebGL/WebGPU render buffers.
 */
export class ExrEncoder {

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ExrEncoderFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_exrencoder_free(ptr, 0);
    }
    /**
     * Create a new EXR image builder.
     * @param {number} width
     * @param {number} height
     */
    constructor(width, height) {
        const ret = wasm.exrencoder_new(width, height);
        this.__wbg_ptr = ret >>> 0;
        ExrEncoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Encode the image to EXR bytes.
     *
     * Returns a Uint8Array containing the complete EXR file.
     * @returns {Uint8Array}
     */
    encode() {
        const ret = wasm.exrencoder_encode(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Add a new layer with the specified channels.
     * The `data` contains all pixels, each pixel with one float per channel.
     * @param {string | null | undefined} name
     * @param {string[]} channel_names
     * @param {Float32Array} interleaved
     * @param {SamplePrecision} precision
     * @param {CompressionMethod} compression
     */
    addLayer(name, channel_names, interleaved, precision, compression) {
        var ptr0 = isLikeNone(name) ? 0 : passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(channel_names, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF32ToWasm0(interleaved, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.exrencoder_addLayer(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, precision, compression);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}

const ExrSimpleImageFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_exrsimpleimage_free(ptr >>> 0, 1));
/**
 * Result of optimized RGB(A) reading.
 */
export class ExrSimpleImage {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ExrSimpleImage.prototype);
        obj.__wbg_ptr = ptr;
        ExrSimpleImageFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ExrSimpleImageFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_exrsimpleimage_free(ptr, 0);
    }
    /**
     * Get the interleaved RGB pixel data as Float32Array.
     * @returns {Float32Array}
     */
    get data() {
        const ret = wasm.exrsimpleimage_data(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Image width in pixels.
     * @returns {number}
     */
    get width() {
        const ret = wasm.exrsimpleimage_width(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Image height in pixels.
     * @returns {number}
     */
    get height() {
        const ret = wasm.exrsimpleimage_height(this.__wbg_ptr);
        return ret >>> 0;
    }
}

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
    imports.wbg.__wbg_error_7534b8e9a36f1ab4 = function(arg0, arg1) {
        let deferred0_0;
        let deferred0_1;
        try {
            deferred0_0 = arg0;
            deferred0_1 = arg1;
            console.error(getStringFromWasm0(arg0, arg1));
        } finally {
            wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
        }
    };
    imports.wbg.__wbg_new_8a6f238a6ece86ea = function() {
        const ret = new Error();
        return ret;
    };
    imports.wbg.__wbg_stack_0ed75d68575b0f3c = function(arg0, arg1) {
        const ret = arg1.stack;
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    };
    imports.wbg.__wbindgen_init_externref_table = function() {
        const table = wasm.__wbindgen_export_3;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
        ;
    };
    imports.wbg.__wbindgen_string_get = function(arg0, arg1) {
        const obj = arg1;
        const ret = typeof(obj) === 'string' ? obj : undefined;
        var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
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
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
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

    if (typeof module_or_path === 'undefined') {
        module_or_path = new URL('exrs_raw_wasm_bindgen_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    __wbg_init_memory(imports);

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync };
export default __wbg_init;
