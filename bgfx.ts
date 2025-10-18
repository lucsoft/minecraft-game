// deno-lint-ignore-file no-import-prefix


import { Arrays, Compounds, Primitives } from "https://raw.githubusercontent.com/MierenManz/byte_type/refs/heads/main/mod.ts";
import {  Union } from "https://raw.githubusercontent.com/MierenManz/byte_type/refs/heads/main/src/compound/union.ts";
import { Window } from "./glfw.ts";
// Load bgfx shared library and define bgfx_init
const lib = Deno.dlopen(
  "./bgfx/.build/osx-arm64/bin/libbgfx-shared-libRelease.dylib",
  {
      "bgfx_render_frame": { parameters: [], result: "i32" },
      "bgfx_init_ctor": { parameters: ["pointer"], result: "bool" },
      "bgfx_init": { parameters: [ "pointer" ], result: "bool" },
      "bgfx_set_platform_data": { parameters: [ "pointer" ], result: "void" },
      "bgfx_set_view_clear": { parameters: [ "u16", "u16", "u32", "f32", "u8" ], result: "void" },
      "bgfx_set_view_rect_ratio": { parameters: [ "u16", "u16", "u16", "u16" ], result: "void" },
      "bgfx_touch": { parameters: [ "u16" ], result: "void" },
      "bgfx_frame": { parameters: [], result: "i32" },
      "bgfx_dbg_text_printf": { parameters: [ "u16", "u16", "u16", "pointer" ], result: "void" },
      "bgfx_set_debug": { parameters: [ "u32" ], result: "void" },
      "bgfx_reset": { parameters: [ "u32" , "u32", "u32", "u32" ], result: "void" },
      "bgfx_dbg_text_clear": { parameters: [ "u8" ], result: "void" },
  }
);

enum bgfx_renderer_type {
    NOOP = 0,           /** ( ) No rendering.                  */
    AGC = 1,            /** ( ) AGC                            */
    DIRECT3D11 = 2,     /** ( ) Direct3D 11.0                  */
    DIRECT3D12 = 3,     /** ( ) Direct3D 12.0                  */
    GNM = 4,            /** ( ) GNM                            */
    METAL = 5,          /** ( ) Metal                          */
    NVN = 6,            /** ( ) NVN                            */
    OPENGLES = 7,       /** ( ) OpenGL ES 2.0+                 */
    OPENGL = 8,         /** ( ) OpenGL 2.1+                    */
    VULKAN = 9,         /** ( ) Vulkan                         */
}

const pointer = Primitives.u64;
const bgfx_platform_data_s = new Compounds.SizedStruct({
    /** Native display type (*nix specific).     */
    ndt: pointer,
    /**
     * Native window handle. If `NULL`, bgfx will create a headless
     * context/device, provided the rendering API supports it.
     */
    nwh: pointer,
    /**
     * GL context, D3D device, or Vulkan device. If `NULL`, bgfx
     * will create context/device.
     */
    context: pointer,
    /**
     * GL back-buffer, or D3D render target view. If `NULL` bgfx will
     * create back-buffer color surface.
     */
    backBuffer: pointer,
    /**
     * Backbuffer depth/stencil. If `NULL`, bgfx will create a back-buffer
     * depth/stencil surface.
     */
    backBufferDS: pointer,
    /** Handle type. Needed for platforms having more than one option. */
    type: Primitives.u32,
});

const bgfx_resolution_t = new Compounds.SizedStruct({
    format: Primitives.u32,
    width: Primitives.u32,
    height: Primitives.u32,
    reset: Primitives.u32,
    numBackBuffers: Primitives.u8,
    maxFrameLatency: Primitives.u8,
    debugTextScale: Primitives.u8
});

const bgfx_init_limits_t = new Compounds.SizedStruct({
    maxEncoders: Primitives.u16,
    minResourceCbSize: Primitives.u32,
    transientVbSize: Primitives.u32,
    transientIbSize: Primitives.u32
});

const bgfx_init_s = new Compounds.Struct({
    rendererType: Primitives.u32,
    vendorId: Primitives.u16,
    deviceId: Primitives.u16,
    debug: Primitives.bool,
    profile: Primitives.bool,
    platformData: bgfx_platform_data_s,
    resolution: bgfx_resolution_t,
    limits: bgfx_init_limits_t,
    callback: pointer,
    allocator: pointer,
})




const window = new Window(800, 600, "Test Window");
const ws = window.windowSize();
let height, width = 0;
height = ws.height;
width = ws.width;

const dataView = new DataView(new ArrayBuffer(bgfx_init_s.maxSize!));
lib.symbols.bgfx_render_frame();
const handle = window.nwh();
const BGFX_RESET_VSYNC = 0x00000080;
const BGFX_CLEAR_COLOR = 0x0001;
const BGFX_DEBUG_TEXT = 0x00000008;
const BGFX_DEBUG_STATS = 0x00000004;
bgfx_init_s.write({
    rendererType: bgfx_renderer_type.VULKAN,
    vendorId: 0,
    deviceId: 0,
    debug: false,
    profile: false,
    platformData: {
        ndt: 0n,
        nwh: Deno.UnsafePointer.value(handle!),
        context: 0n,
        backBuffer: 0n,
        backBufferDS: 0n,
        type: 0,
    },
    resolution: {
        format: 0,
        width: width,
        height: height,
        reset: BGFX_RESET_VSYNC,
        numBackBuffers: 0,
        maxFrameLatency: 0,
        debugTextScale: 10
    },
    limits: {
        maxEncoders: 0,
        minResourceCbSize: 0,
        transientVbSize: 0,
        transientIbSize: 0
    },
    allocator: 0n,
    callback: 0n,
}, dataView);


const bgfx_view_id_t = Primitives.u16;

// lib.symbols.bgfx_init_ctor(Deno.UnsafePointer.of(dataView));
if (!lib.symbols.bgfx_init(Deno.UnsafePointer.of(dataView))) {
    throw new Error("Failed to initialize bgfx");
}
const kClearView = 0;
lib.symbols.bgfx_set_view_clear(kClearView, BGFX_CLEAR_COLOR, 0, 0, 0);
lib.symbols.bgfx_set_view_rect_ratio(kClearView, 0, 0, 0);
for await (const _ of window.run()) {
    // Game loop
    const oldWidth = width;
    const oldHeight = height;
    const ws = window.windowSize();
    width = ws.width;
    height = ws.height;
    if (ws.width !== oldWidth || ws.height !== oldHeight) {
        lib.symbols.bgfx_reset(width, height, BGFX_RESET_VSYNC, 0);
        lib.symbols.bgfx_set_view_rect_ratio(kClearView, 0, 0, 0);
    }
    lib.symbols.bgfx_touch(kClearView);
    lib.symbols.bgfx_dbg_text_clear(0);
    lib.symbols.bgfx_dbg_text_printf(80, 0, 0x0F, Deno.UnsafePointer.of(new TextEncoder().encode("Hello, bgfx!\0")));
    lib.symbols.bgfx_dbg_text_printf(80, 1, 0x0F, Deno.UnsafePointer.of(new TextEncoder().encode("Hello, bgfx!\0")));
    lib.symbols.bgfx_set_debug(BGFX_DEBUG_TEXT | BGFX_DEBUG_STATS);
    lib.symbols.bgfx_frame();
}