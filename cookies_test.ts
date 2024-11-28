import { assertEquals } from "@std/assert";
import makeFetchCookie from "fetch-cookie";
import { parseMozillaCookies } from "./cookies.ts";

Deno.test(async function parseCookies() {
    const jar = new makeFetchCookie.toughCookie.CookieJar();
    const cookies = `# Netscape HTTP Cookie File
# https://curl.haxx.se/rfc/cookie_spec.html
# This is a generated file! Do not edit.

.twitter.com	TRUE	/	TRUE	9754056585	test	test`;

    parseMozillaCookies(jar, cookies);

    assertEquals(await jar.getCookieString("https://twitter.com"), "test=test");
});
