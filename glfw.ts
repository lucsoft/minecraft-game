import { Primitives } from "https://raw.githubusercontent.com/MierenManz/byte_type/refs/heads/main/mod.ts";

const { symbols: s } = Deno.dlopen("/opt/homebrew/lib/libglfw.dylib", {
    "glfwSetErrorCallback": { parameters: [ "function" ], result: "void" },
    "glfwInit": { parameters: [], result: "bool" },
    "glfwWindowHint": { parameters: ["i32", "i32"], result: "void" },
    "glfwCreateWindow": { parameters: [ "i32", "i32", "pointer", "pointer", "pointer" ], result: "pointer" },
    "glfwSetKeyCallback": { parameters: [ "pointer", "function" ], result: "pointer" },
    "glfwGetWindowSize": { parameters: [ "pointer", "pointer", "pointer" ], result: "void" },
    "glfwGetCocoaWindow": { parameters: [ "pointer" ], result: "pointer" },
    "glfwWindowShouldClose": { parameters: [ "pointer" ], result: "bool", nonblocking: true },
    "glfwPollEvents": { parameters: [], result: "void" },
});

const errorCallback = new Deno.UnsafeCallback({
    parameters: [ "i32", "pointer" ],
    result: "void",

}, (errCode: number, descriptionPtr: Deno.PointerValue) => {
    const description = Deno.UnsafePointerView.getCString(descriptionPtr!);
    console.error(`GLFW Error [${errCode}]: ${description}`);
});

s.glfwSetErrorCallback(errorCallback.pointer);
s.glfwInit();
export const GLFW_CLIENT_API = 0x00022001;
export const GLFW_NO_API = 0;
s.glfwWindowHint(GLFW_CLIENT_API, GLFW_NO_API);
export class Window {
    #window: Deno.PointerValue;
    constructor(width: number, height: number, title: string, monitor: Deno.PointerValue = null, share: Deno.PointerValue = null) {
        this.#window = s.glfwCreateWindow(width, height, Deno.UnsafePointer.of(new TextEncoder().encode(title + "\0")), monitor, share);
    }

    nwh(): Deno.PointerValue {
        return s.glfwGetCocoaWindow(this.#window);
    }

    windowSize(): { width: number; height: number; } {
        const width = new Uint8Array(Primitives.i32.byteSize).buffer;
        const height = new Uint8Array(Primitives.i32.byteSize).buffer;
        s.glfwGetWindowSize(this.#window, Deno.UnsafePointer.of(width), Deno.UnsafePointer.of(height));
        return {
            width: Primitives.i32.read(new DataView(width)),
            height: Primitives.i32.read(new DataView(height)),
        }
    }

    shouldClose(): Promise<boolean> {
        return s.glfwWindowShouldClose(this.#window);
    }

    run() {
        // deno-lint-ignore no-this-alias
        const thisClass = this;
        return ReadableStream.from({
            [ Symbol.asyncIterator ]() {
                return {
                    async next() {
                        const response = await thisClass.shouldClose();
                        s.glfwPollEvents();
                        if (response) {
                            return {
                                done: true,
                            };
                        };
                        return {
                            done: false,
                            value: response,
                        }
                    }
                }
            }
        })
    }
}