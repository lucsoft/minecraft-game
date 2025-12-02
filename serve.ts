// deno-lint-ignore-file no-import-prefix
import { serve } from "https://deno.land/x/esbuild_serve@1.5.0/mod.ts";

serve({
    assets: {
        "minecraft.jar": "./1.21.10.jar"
    },
    pages: {
        "index": "index.ts"
    }
})