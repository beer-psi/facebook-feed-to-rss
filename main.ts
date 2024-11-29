import * as dotenv from "@std/dotenv";
import * as cheerio from "cheerio";
import { Hono } from "@hono/hono";
import { getConnInfo } from "@hono/hono/deno";
import { HTTPException } from "@hono/hono/http-exception";
import { requestId, RequestIdVariables } from "@hono/hono/request-id";
import { getPath, getQueryParams } from "@hono/hono/utils/url";
import { openKvToolbox } from "@kitsonk/kv-toolbox";
import { Feed } from "feed";
import makeFetchCookie from "fetch-cookie";
import { parseMozillaCookies } from "./cookies.ts";
import { FacebookError, FacebookImageCollection, FacebookProfile } from "./facebook.ts";
import {
    HTTP_200_OK,
    HTTP_302_FOUND,
    HTTP_400_BAD_REQUEST,
    HTTP_500_INTERNAL_SERVER_ERROR,
} from "./status-codes.ts";
import { NextData, SyndicationProps } from "./twitter.ts";
import { FeedOptions } from "feed";
import { Item } from "feed";

type CachedFeed = {
    feed: FeedOptions;
    items: Array<Item>;
};

await dotenv.load({ export: true });

const BASE_URL = Deno.env.get("BASE_URL");
const GRAPH_ACCESS_TOKEN = Deno.env.get("GRAPH_ACCESS_TOKEN");
const TWITTER_COOKIES = Deno.env.get("TWITTER_COOKIES") ?? "";
const HEADERS = {
    accept: "*/*",
    "accept-language": "en-US,en;q=0.5",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
};

if (!GRAPH_ACCESS_TOKEN || !BASE_URL) {
    throw new Error("GRAPH_ACCESS_TOKEN or BASE_URL not set in environment.");
}

const kv = await openKvToolbox({});
const jar = new makeFetchCookie.toughCookie.CookieJar();
const twitterFetch = makeFetchCookie(fetch, jar);

if (TWITTER_COOKIES) {
    parseMozillaCookies(jar, TWITTER_COOKIES);
}

const app = new Hono<{
    Variables: RequestIdVariables;
}>();

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

app.get("/facebook/image/:id", async (c) => {
    const url = new URL(
        `/v21.0/${encodeURIComponent(c.req.param("id"))}`,
        "https://graph.facebook.com",
    );

    url.searchParams.set("access_token", GRAPH_ACCESS_TOKEN);
    url.searchParams.set("fields", "images");

    const resp = await fetch(url, {
        headers: {
            ...HEADERS,
            origin: "https://www.facebook.com",
            referer: "https://www.facebook.com/",
        },
    });
    const data = (await resp.json()) as FacebookImageCollection | FacebookError;

    if ("error" in data) {
        throw new HTTPException(HTTP_400_BAD_REQUEST, {
            message: data.error.message,
        });
    }

    data.images.sort((a, b) => (b.height * b.width) - (a.height * a.width));

    return c.redirect(data.images[0].source, HTTP_302_FOUND);
});

app.get("/facebook/video/:id", async (c) => {
    const url = new URL(
        `/v21.0/${encodeURIComponent(c.req.param("id"))}`,
        "https://graph.facebook.com",
    );

    url.searchParams.set("access_token", GRAPH_ACCESS_TOKEN);
    url.searchParams.set("fields", "source");

    const resp = await fetch(url, {
        headers: {
            ...HEADERS,
            origin: "https://www.facebook.com",
            referer: "https://www.facebook.com/",
        },
    });
    const data = (await resp.json()) as
        | { id: string; source: string }
        | FacebookError;

    if ("error" in data) {
        throw new HTTPException(HTTP_400_BAD_REQUEST, {
            message: data.error.message,
        });
    }

    return c.redirect(data.source, HTTP_302_FOUND);
});

app.get("/facebook/profile-picture/:user", async (c) => {
    const user = c.req.param("user");
    const url = new URL(
        `/v21.0/${encodeURIComponent(user)}`,
        "https://graph.facebook.com",
    );

    url.searchParams.set("access_token", GRAPH_ACCESS_TOKEN);
    url.searchParams.set("fields", "picture");

    const resp = await fetch(url, {
        headers: {
            ...HEADERS,
            origin: "https://www.facebook.com",
            referer: "https://www.facebook.com/",
        },
    });
    const data = (await resp.json()) as
        | Pick<FacebookProfile, "picture">
        | FacebookError;

    if ("error" in data) {
        throw new HTTPException(HTTP_400_BAD_REQUEST, {
            message: data.error.message,
        });
    }

    return c.redirect(data.picture.data.url, HTTP_302_FOUND);
});

app.get("/rss", async (c) => {
    const user = c.req.query("username")?.toLowerCase();

    if (!user) {
        throw new HTTPException(HTTP_400_BAD_REQUEST, { message: "Missing user query parameter" });
    }

    const cachedFeedData = await kv.getAsBlob(
        ["facebook", user],
        { consistency: "eventual" },
    );

    if (cachedFeedData !== null) {
        const resp = new Response(
            cachedFeedData.stream().pipeThrough(new DecompressionStream("gzip")),
        );
        const cachedFeed: CachedFeed = JSON.parse(
            await resp.text(),
        );

        if (cachedFeed.feed.updated) {
            cachedFeed.feed.updated = new Date(cachedFeed.feed.updated);
        }

        const feed = new Feed(cachedFeed.feed);
        const items = cachedFeed.items;

        items.sort((a, b) => b.date.valueOf() - a.date.valueOf());

        for (const item of items) {
            if (item.date) {
                item.date = new Date(item.date);
            }

            if (item.published) {
                item.published = new Date(item.published);
            }

            feed.addItem(item);
        }

        return c.text(feed.rss2(), HTTP_200_OK, {
            "Content-Type": "application/rss+xml; charset=utf-8",
        });
    }

    const url = new URL(
        `/v21.0/${encodeURIComponent(user)}`,
        "https://graph.facebook.com",
    );

    url.searchParams.set("access_token", GRAPH_ACCESS_TOKEN);
    url.searchParams.set(
        "fields",
        "name,about,link,picture,posts{created_time,message,story,permalink_url,attachments}",
    );

    const resp = await fetch(url, {
        headers: {
            ...HEADERS,
            origin: "https://www.facebook.com",
            referer: "https://www.facebook.com/",
        },
    });
    const data = (await resp.json()) as FacebookProfile | FacebookError;

    if ("error" in data) {
        throw new HTTPException(HTTP_400_BAD_REQUEST, {
            message: data.error.message,
        });
    }

    const feedOptions: FeedOptions = {
        title: data.name,
        description: data.about,
        id: data.id,
        link: data.link,
        updated: new Date(),
        image: new URL(`/facebook/profile-picture/${encodeURIComponent(user)}`, BASE_URL)
            .toString(),
        copyright: "",
    };
    const feed = new Feed(feedOptions);

    for (const post of data.posts.data) {
        const postId = post.id.split("_")[1];

        let content = (post.message ?? post.story ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&apos;")
            .trim();

        // maimaiDX/CHUNITHM.International.Ver
        if (data.id === "108610093912972" || data.id === "100784445056884") {
            content = content.split(/^[-—]{5,}$/gm)[0]
                .replace("(請注意：中文內容設於下方)\n", "")
                .trim();
        }

        const title = content.split("\n\n")[0];
        let description = content.replaceAll("\n", "<br>\n");

        if (post.attachments) {
            for (const attachment of post.attachments.data) {
                if (
                    attachment.type === "photo" ||
                    attachment.type === "cover_photo" ||
                    attachment.type === "profile_media"
                ) {
                    description += `\n<br><img src="${new URL(
                        `/facebook/image/${attachment.target.id}`,
                        BASE_URL,
                    )}">`;
                } else if (
                    attachment.type === "video_autoplay" ||
                    attachment.type === "video_direct_response_autoplay"
                ) {
                    description += `\n<br><img src="${new URL(
                        `/facebook/video/${attachment.target.id}`,
                        BASE_URL,
                    )}">`;
                } else if (attachment.type === "album") {
                    for (
                        const subattachment of attachment.subattachments.data
                    ) {
                        if (
                            subattachment.type === "photo" ||
                            subattachment.type === "cover_photo" ||
                            subattachment.type === "profile_media"
                        ) {
                            description += `\n<br><img src="${new URL(
                                `/facebook/image/${subattachment.target.id}`,
                                BASE_URL,
                            )}">`;
                        } else if (
                            subattachment.type === "video_autoplay" ||
                            subattachment.type ===
                                "video_direct_response_autoplay"
                        ) {
                            description += `\n<br><img src="${new URL(
                                `/facebook/video/${subattachment.target.id}`,
                                BASE_URL,
                            )}">`;
                        }
                    }
                }
            }
        }

        const item: Item = {
            title,
            description,
            link: `https://facebook.com/${data.id}/posts/${postId}`,
            id: `https://facebook.com/${data.id}/posts/${postId}`,
            date: new Date(post.created_time),
        };

        feed.addItem(item);
    }

    const cached = JSON.stringify({
        feed: feed.options,
        items: feed.items,
    });

    await kv.atomic()
        .setBlob(
            ["facebook", data.id],
            new Blob([cached], { type: "application/json" })
                .stream()
                .pipeThrough(new CompressionStream("gzip")),
            { expireIn: 30 * 60 * 1000 },
        )
        .setBlob(
            ["facebook", user],
            new Blob([cached], { type: "application/json" })
                .stream()
                .pipeThrough(new CompressionStream("gzip")),
            { expireIn: 30 * 60 * 1000 },
        )
        .commit();

    return c.text(feed.rss2(), HTTP_200_OK, {
        "Content-Type": "application/rss+xml; charset=utf-8",
    });
});

app.get("/twitter-rss/:username", async (c) => {
    const username = c.req.param("username").toLowerCase();

    const cachedFeedData = await kv.getAsBlob(
        ["twitter", username],
        { consistency: "eventual" },
    );

    if (cachedFeedData !== null) {
        const resp = new Response(
            cachedFeedData.stream().pipeThrough(new DecompressionStream("gzip")),
        );
        const cachedFeed: CachedFeed = JSON.parse(
            await resp.text(),
        );

        if (cachedFeed.feed.updated) {
            cachedFeed.feed.updated = new Date(cachedFeed.feed.updated);
        }

        const feed = new Feed(cachedFeed.feed);
        const items = cachedFeed.items;

        items.sort((a, b) => b.date.valueOf() - a.date.valueOf());

        for (const item of items) {
            if (item.date) {
                item.date = new Date(item.date);
            }

            if (item.published) {
                item.published = new Date(item.published);
            }

            feed.addItem(item);
        }

        return c.text(feed.rss2(), HTTP_200_OK, {
            "Content-Type": "application/rss+xml; charset=utf-8",
        });
    }

    const url = new URL(
        `/srv/timeline-profile/screen-name/${encodeURIComponent(username)}`,
        "https://syndication.twitter.com",
    );
    const resp = await twitterFetch(url, {
        headers: {
            ...HEADERS,
            origin: "https://syndication.twitter.com",
            referer: "https://syndication.twitter.com/",
        },
    });
    const $ = cheerio.load(await resp.text());

    const rawData = $("#__NEXT_DATA__").html();

    if (!rawData) {
        throw new HTTPException(HTTP_500_INTERNAL_SERVER_ERROR);
    }

    const data: NextData<SyndicationProps> = JSON.parse(rawData);
    const timeline = data.props.pageProps.timeline;

    if (timeline.entries.length < 1) {
        return c.text("");
    }

    timeline.entries.sort((a, b) =>
        new Date(b.content.tweet.created_at).valueOf() -
        new Date(a.content.tweet.created_at).valueOf()
    );

    const user = timeline.entries[0].content.tweet.user;
    const feedOptions: FeedOptions = {
        title: `${user.name} (@${user.screen_name})`,
        description: user.description,
        id: user.id_str,
        link: `https://twitter.com/${user.screen_name}`,
        image: user.profile_image_url_https,
        copyright: "",
    };
    const feed = new Feed(feedOptions);

    for (const tweet of timeline.entries) {
        if (tweet.type !== "tweet") {
            continue;
        }

        if (tweet.content.tweet.retweeted_status) {
            continue;
        }

        const content = tweet.content.tweet.full_text
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&apos;")
            .trim();
        const title = content.split("\n")[0];
        let description = content.replaceAll("\n", "<br>\n");

        for (const urlEntity of tweet.content.tweet.entities.urls) {
            description = description.replaceAll(urlEntity.url, urlEntity.expanded_url);
        }

        for (const mediaEntity of tweet.content.tweet.entities.media) {
            description = description.replaceAll(mediaEntity.url, "");
            description += `<br>\n<img src="${mediaEntity.media_url_https}">`;

            // if (mediaEntity.type === "photo") {
            //     description += `<br>\n<img src="${mediaEntity.media_url_https}">`;
            // } else if (mediaEntity.type === "video") {
            //     description += "<br>\n<video>\n";

            //     for (const variant of mediaEntity.video_info.variants) {
            //         if (variant.content_type === "application/x-mpegURL") {
            //             description +=
            //                 `   <source src="${variant.url}" type="${variant.content_type}">\n`;
            //             continue;
            //         }

            //         const variantUrl = new URL(variant.url);
            //         const resolution = variantUrl.pathname.split("/")[5];
            //         const width = resolution.split("x")[1];

            //         description +=
            //             `   <source src="${variant.url}" type="${variant.content_type}" media="(min-width: ${width}px)">\n`;
            //     }

            //     description += "</video>";
            // }
        }

        const item: Item = {
            title,
            description,
            link: `https://twitter.com${tweet.content.tweet.permalink}`,
            id: `https://twitter.com${tweet.content.tweet.permalink}`,
            date: new Date(tweet.content.tweet.created_at),
        };

        feed.addItem(item);
    }

    const cached = JSON.stringify({
        feed: feed.options,
        items: feed.items,
    });

    await kv.setBlob(
        ["twitter", username],
        new Blob([cached], { type: "application/json" })
            .stream()
            .pipeThrough(new CompressionStream("gzip")),
        { expireIn: 30 * 60 * 1000 },
    );

    return c.text(feed.rss2(), HTTP_200_OK, {
        "Content-Type": "application/rss+xml; charset=utf-8",
    });
});

Deno.cron("reset cache", "0 0 * * *", async () => {
    const atomic = kv.atomic();

    for await (const item of kv.list({ prefix: [] })) {
        atomic.delete(item.key);
    }

    await atomic.commit();
});

Deno.serve(
    { port: Number(Deno.env.get("PORT") ?? 8000) },
    app.fetch,
);
