import { Hono } from "jsr:@hono/hono";
import { basicAuth } from "jsr:@hono/hono/basic-auth";
import { getConnInfo } from "jsr:@hono/hono/deno";
import { requestId, RequestIdVariables } from "jsr:@hono/hono/request-id";
import { getPath, getQueryParams } from "jsr:@hono/hono/utils/url";

const AUTH_USER = Deno.env.get("AUTH_USER");
const AUTH_PASSWORD = Deno.env.get("AUTH_PASSWORD");
const PORT = Deno.env.get("PORT");

const app = new Hono<{
    Variables: RequestIdVariables;
}>();

if (AUTH_USER || AUTH_PASSWORD) {
    app.use(
        basicAuth({
            username: AUTH_USER ?? "",
            password: AUTH_PASSWORD ?? "",
        }),
    );
}

app.use(requestId());
app.use(async (c, next) => {
    const connInfo = getConnInfo(c);
    const method = c.req.method;
    const path = getPath(c.req.raw);
    const params = getQueryParams(c.req.raw.url);
    const time = new Date();

    console.log(
        `<-- id=${c.get("requestId")} ip=${connInfo.remote.address} user_agent=${
            c.req.header("User-Agent")
        } method=${method} path=${path} query=${
            JSON.stringify(params ?? {})
        } timestamp=${time.toISOString()}`,
    );

    await next();

    const status = c.res.status;
    let logFn = console.log;

    if (status >= 500) {
        logFn = console.error;
    } else if (status >= 400) {
        logFn = console.warn;
    }

    logFn(
        `--> id=${c.get("requestId")} status=${c.res.status} time=${Date.now() - time.valueOf()}ms`,
    );
});

app.on(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"], "/*", async (c) => {
    const requestUrl = new URL(c.req.raw.url);
    const url = requestUrl.pathname.slice(1) + requestUrl.search;
    
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
