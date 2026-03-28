from denoland/deno:2.7.6

workdir /app
copy deno.jsonc .
copy deno.lock .

run deno install --frozen

copy . .

run deno task build

from joseluisq/static-web-server:2.36-alpine

copy --from=0 /app/dist /public