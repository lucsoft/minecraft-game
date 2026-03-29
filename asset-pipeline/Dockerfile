from denoland/deno:2.7.6

workdir /app
copy deno.jsonc .
copy deno.lock .

run deno install --frozen

copy asset-pipeline ./asset-pipeline

run deno compile --cached-only --output /server -A --unstable-kv ./asset-pipeline/mod.ts

from denoland/deno:2.7.6

workdir /app
copy --from=0 /server .

cmd ["/app/server"]