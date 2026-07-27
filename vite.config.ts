
import { defineConfig } from "vite";
import deno from "@deno/vite-plugin"

export default defineConfig({
    plugins: [
        deno()
    ],
    server: {
        host: "0.0.0.0"
    },
    build: {
        rollupOptions: {
            input: {
                main: "index.html",
                merge: "merge.html"
            }
        }
    }
})