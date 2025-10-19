import { WindowBuilder, EventType, Canvas, Texture, Window, PixelFormat, TextureAccess, Rect } from "@divy/sdl2";

function getRowPadding(width: number) {
  const bytesPerPixel = 4;
  const unpaddedBytesPerRow = width * bytesPerPixel;
  const align = 256;
  const paddedBytesPerRowPadding = (align - unpaddedBytesPerRow % align) %
    align;
  const paddedBytesPerRow = unpaddedBytesPerRow + paddedBytesPerRowPadding;

  return {
    unpadded: unpaddedBytesPerRow,
    padded: paddedBytesPerRow,
  };
}

export class WebGPUWIndow {
    dimensions = {
        width: 800,
        height: 800,
    };
    screenDimensions = {
        width: 800,
        height: 800,
    };
    canvas: Canvas;
    sdl2texture: Texture;
    window: Window;
    texture: GPUTexture;
    outputBuffer: GPUBuffer;

    constructor(public device: GPUDevice) {
        const window = new WindowBuilder(
            "Hello, Deno!",
            this.dimensions.width,
            this.dimensions.height,
        ).build();
        this.canvas = window.canvas();
        this.window = window;
        const creator = this.canvas.textureCreator();
        this.sdl2texture = creator.createTexture(
            PixelFormat.ABGR8888,
            TextureAccess.Streaming,
            this.dimensions.width,
            this.dimensions.height,
        );
        this.texture = this.device.createTexture({
            label: "Capture",
            size: this.dimensions,
            format: "rgba8unorm-srgb",
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        const { padded } = getRowPadding(this.dimensions.width);
        this.outputBuffer = this.device.createBuffer({
            label: "Capture",
            size: padded * this.dimensions.height,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
    }

    async draw(rendering: (encoder: GPUCommandEncoder, view: GPUTextureView) => void) {
        const encoder = this.device.createCommandEncoder();
        const { padded, unpadded } = getRowPadding(this.dimensions.width);
        rendering(encoder, this.texture.createView());
        encoder.copyTextureToBuffer(
        { texture: this.texture },
        {
            buffer: this.outputBuffer,
            bytesPerRow: padded,
            rowsPerImage: 0,
        },
        this.dimensions,
        );
        this.device.queue.submit([encoder.finish()]);
        await this.outputBuffer.mapAsync(1);
        const buf = new Uint8Array(this.outputBuffer.getMappedRange());
        const buffer = new Uint8Array(unpadded * this.dimensions.height);
        for (let i = 0; i < this.dimensions.height; i++) {
        const slice = buf
            .slice(i * padded, (i + 1) * padded)
            .slice(0, unpadded);

        buffer.set(slice, i * unpadded);
        }
        this.sdl2texture.update(buffer, this.dimensions.width * 4);
        const rect = new Rect(0, 0, this.dimensions.width, this.dimensions.height);
        const screen = new Rect(0, 0, this.screenDimensions.width, this.screenDimensions.height);
        this.canvas.copy(this.sdl2texture, rect, screen);
        this.canvas.present();
        this.outputBuffer.unmap();
    }
}

export async function getDevice() {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice();
    return device;
}