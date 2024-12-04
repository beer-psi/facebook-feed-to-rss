import { Hono } from "jsr:@hono/hono";
import { basicAuth } from "jsr:@hono/hono/basic-auth";

const AUTH_USER = Deno.env.get("AUTH_USER");
const AUTH_PASSWORD = Deno.env.get("AUTH_PASSWORD");
const PORT = Deno.env.get("PORT");

const app = new Hono();

if (AUTH_USER || AUTH_PASSWORD) {
    app.use(
        basicAuth({
            username: AUTH_USER ?? "",
            password: AUTH_PASSWORD ?? "",
        }),
    );
}

app.on(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"], "/*", async (c) => {
    const url = c.req.path.slice(1);
    
    const init: RequestInit = {
        credentials: "include",
        headers: c.req.header(),
        method: c.req.method,
        redirect: "manual",
    };

    if (!["GET", "HEAD"].includes(c.req.method)) {
        init.body = await c.req.blob();
    }

    return fetch(url, init);
});

Deno.serve({ port: PORT ? Number(PORT) : 8888 }, app.fetch);
