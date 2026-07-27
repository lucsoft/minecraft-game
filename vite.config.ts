
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, Plugin } from "vite";
import deno from "@deno/vite-plugin"

/**
 * In production static-web-server answers /sound with a redirect to /sound/ and then serves the
 * index.html in that folder. The dev server does not, it would hand back the SPA fallback instead,
 * so the page only exists at the URL it was asked for on one of the two.
 */
function folderPages(): Plugin {
    return {
        name: "folder-pages",
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const [ path, query ] = (request.url ?? "").split("?");
                if (path && !path.endsWith("/") && !path.includes(".") && existsSync(join(server.config.root, path, "index.html"))) {
                    response.statusCode = 301;
                    response.setHeader("Location", `${path}/${query ? `?${query}` : ""}`);
                    return response.end();
                }
                next();
            });
        },
    };
}

export default defineConfig({
    plugins: [
        deno(),
        folderPages()
    ],
    server: {
        host: "0.0.0.0"
    },
    build: {
        rollupOptions: {
            input: {
                main: "index.html",
                merge: "merge.html",
                // its own folder so the page is served at /sound rather than /sound.html
                sound: "sound/index.html"
            }
        }
    }
})
