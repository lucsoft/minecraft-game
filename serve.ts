// deno-lint-ignore-file no-import-prefix
import { serve } from "https://deno.land/x/esbuild_serve@1.5.0/mod.ts";

serve({
    assets: {
        "minecraft.jar": "./1.21.1-21.1.197.jar",
        "MinecraftRegular.otf": "./MinecraftRegular.otf",
    },
    pages: {
        "index": "index.ts"
    }
})