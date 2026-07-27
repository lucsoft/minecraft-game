const minecraftTargetJar = "https://piston-data.mojang.com/v1/objects/d3bdf582a7fa723ce199f3665588dcfe6bf9aca8/client.jar";

export const assetPipeline = new URL(`${location.hostname === "localhost" ? "http://localhost:8000" : "https://asset-pipeline.lucsoft.de/"}?${new URLSearchParams({ url: minecraftTargetJar })}`);

export function assetFileUrl(file: string) {
    const url = new URL(assetPipeline);
    url.searchParams.set("file", file);
    return url.toString();
}

export function textureFileUrl(name: string) {
    return assetFileUrl(`assets/minecraft/textures/${name}.png`);
}

/** sounds come from the version's asset objects, the pipeline resolves and caches them */
export function soundFileUrl(name: string) {
    const url = new URL(assetPipeline);
    url.searchParams.set("sound", name);
    return url.toString();
}
