import { CookieJar } from "fetch-cookie";

const NETSCAPE_MAGIC = /^#( Netscape)? HTTP Cookie File/u;

type CookieAttributes = {
    Domain?: string;
    Expires?: Date;
    HttpOnly?: boolean;
    "Max-Age"?: number;
    Partitioned?: boolean;
    Path?: string;
    Secure?: boolean;
    SameSite?: "Strict" | "Lax" | "None";
};

export function parseMozillaCookies(jar: CookieJar, content: string) {
    if (!content.match(NETSCAPE_MAGIC)) {
        throw new TypeError("The content does not look like a Netscape format cookies file.");
    }

    for (let row of content.split(/\r?\n/gu)) {
        const attrs: CookieAttributes = {};

        if (row.startsWith("#HttpOnly_")) {
            attrs.HttpOnly = true;
        }

        if (row.endsWith("\n")) {
            row = row.slice(0, -1);
        }

        if (row.startsWith("#") || row.trim() === "") {
            continue;
        }

        const [domain, domainSpecified, path, secure, expires, name, value] = row.split("\t");

        attrs.Domain = domain;
        attrs.Path = path;
        attrs.Expires = new Date(Number(expires) * 1000);

        if (secure === "TRUE") {
            attrs.Secure = true;
        }

        let cookieString = "";

        if (name === "") {
            cookieString += value;
        } else {
            cookieString += `${name}=${value}`;
        }

        for (const [name, value] of Object.entries(attrs)) {
            if (value === true) {
                cookieString += `; ${name}`;
            } else if (value instanceof Date) {
                cookieString += `; ${name}=${value.toUTCString()}`;
            } else if (value !== false) {
                cookieString += `; ${name}=${value}`;
            }
        }

        const currentUrl = `https://${domain.startsWith(".") ? domain.substring(1) : domain}`;

        jar.setCookie(cookieString, currentUrl, { ignoreError: false });
    }
}
