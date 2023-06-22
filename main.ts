import { Feed } from "https://esm.sh/feed@4.2.2";
import { serve } from "https://deno.land/std@0.182.0/http/server.ts";
import {
  ReasonPhrases,
  StatusCodes,
} from "https://esm.sh/http-status-codes@2.2.0";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
// import "https://deno.land/x/dotenv/load.ts";

interface StoryAttachment {
  media: {
    image: {
      src: string;
    };
  };
  subattachments?: {
    data: Omit<StoryAttachment, "subattachments">[];
  };
  target: {
    url: string;
    id?: string;
  }
  type: string;
}

interface Photo {
  images: {
    height: number;
    source: string;
    width: number;
  }[];
}

const DISCORD_WEBHOOK_URL = Deno.env.get("DISCORD_WEBHOOK_URL")!;
const GRAPH_ACCESS_TOKEN = Deno.env.get("GRAPH_ACCESS_TOKEN")!;

const pool = new Pool(
  {
    tls: {
      caCertificates: [
        Deno.readTextFileSync(new URL("./prod-ca-2021.crt", import.meta.url)),
      ],
    },
  },
  3,
  true,
);

// Connect to the database
const connection = await pool.connect();

try {
  // Create the table
  await connection.queryObject`
		CREATE TABLE IF NOT EXISTS cached_image_urls (
			id BIGINT PRIMARY KEY,
			url TEXT NOT NULL
		);

    CREATE TABLE IF NOT EXISTS cached_rss_feeds (
      id TEXT PRIMARY KEY,
      feed TEXT NOT NULL,
      expiration TIMESTAMPTZ NOT NULL DEFAULT date_round(NOW() + INTERVAL '30 minutes', '30 minutes')
    );
	`;
} finally {
  // Release the connection back into the pool
  connection.release();
}

async function uploadAttachments(urls: Map<bigint, string>): Promise<Map<bigint, string>> {
  const ret = new Map<bigint, string>();
  const imageUrls = new Map<bigint, string>(urls);

  // --------------------------------------
  // Fetch higher quality images
  // --------------------------------------
  for (let i = 0; i < Math.ceil(imageUrls.size / 50); i++) {
    const url = new URL("/v17.0", "https://graph.facebook.com");
    url.searchParams.set("access_token", GRAPH_ACCESS_TOKEN);
    url.searchParams.set("fields", "images");
    url.searchParams.set("ids", [...imageUrls.keys()].slice(i * 50, (i + 1) * 50).join(","));

    const resp = await fetch(url);
    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error.message);
    }

    for (const [id, photo] of Object.entries<Photo>(data)) {
      if (photo.images?.[0]?.source) {
        imageUrls.set(BigInt(id), photo.images[0].source);
      }
    }
  }

  for (let i = 0; i < Math.ceil(imageUrls.size / 10); i++) {
    const formData = new FormData();
    const payload: {
      content: string;
      attachments: { id: number; filename: string }[];
    } = {
      content: "",
      attachments: [],
    };
    
    let index = 0;

    
    for (const [id, url] of [...imageUrls.entries()].slice(i * 10, (i + 1) * 10)) {
      const blob = await fetch(url).then((r) => r.blob());

      formData.append(`files[${index}]`, blob, `${id}.jpg`);
      payload.attachments.push({
        id: index,
        filename: `${id}.jpg`,
      });
      index++;
    }
    payload.content = payload.attachments.map((it) => it.filename).join(", ");
    formData.append("payload_json", JSON.stringify(payload));

    // --------------------------------------
    // Upload new images
    // --------------------------------------
    if (index > 0) {
      const resp = await fetch(DISCORD_WEBHOOK_URL, {
        body: formData,
        method: "POST",
      });
      const json = await resp.json();
      if (json.attachments) {
        json.attachments.forEach(
          ({ filename, url }: { filename: string; url: string }) => {
            const id = filename.replace(".jpg", "");
            ret.set(BigInt(id), url);
          },
        );
      }
    }
  } 
  return ret;
}

async function getRssFeed(user: string): Promise<string> {
  const url = new URL(`/v17.0/${user}`, "https://graph.facebook.com");
  url.searchParams.set("access_token", GRAPH_ACCESS_TOKEN);
  url.searchParams.set("fields", "name,about,link,picture,posts{created_time,message,story,permalink_url,attachments}");

  const resp = await fetch(url);
  const data = await resp.json();

  if (!resp.ok) {
    throw new Error(data.error.message);
  }

  const feed = new Feed({
    title: data.name,
    description: data.about,
    id: user,
    link: data.link,
    language: "en",
    image: data.picture.data.url,
    copyright: "",
  });

  // --------------------------------------
  // Build feed
  // --------------------------------------s
  const imageUrls: Map<bigint, string> = new Map();

  for (const post of data.posts.data) {
    const id = post.id.split("_")[1];
    
    const content = (post.message ?? post.story)
      .split(/^[-—]{5,}$/gm)[0]
      .replace("(請注意：中文內容設於下方)\n", "")
      .trim();
    const title = content.split("\n\n")[0];

    let description = content.replaceAll("\n", "<br>\n");
    const attachments: StoryAttachment[] = post.attachments?.data.flatMap((e: StoryAttachment) => e.subattachments?.data ?? e)
      .filter((attachment: StoryAttachment) => attachment?.target?.id && attachment?.type === "photo")
      // .slice(0, 1); // remove this line to include all attachments
    
    for (const attachment of attachments ?? []) {
      const attachmentId = attachment.target.id as string;

      imageUrls.set(BigInt(attachmentId), attachment.media.image.src);
      description += `\n<br><img src="$${attachmentId}">`;
    }

    feed.addItem({
      title,
      description,
      link: `https://facebook.com/${user}/posts/${id}`,
      id: `https://facebook.com/${user}/posts/${id}`,
      date: new Date(post.created_time),
    });
  }

  let feedString = feed.rss2();
  const connection = await pool.connect();
  try {
    // --------------------------------------
    // Fetch cached images
    // --------------------------------------
    const images = await connection.queryObject<{ id: bigint; url: string }>(
      "SELECT id, url FROM cached_image_urls WHERE id = ANY($1::bigint[])",
      [[...imageUrls.keys()]],
    );

    for (const image of images.rows) {
      imageUrls.delete(image.id);
      feedString = feedString.replaceAll(`$${image.id}`, image.url);
    }

    // --------------------------------------
    // Prepare new images for upload
    // --------------------------------------
    const uploadedImages = await uploadAttachments(imageUrls);
    for (const [id, url] of uploadedImages.entries()) {
      feedString = feedString.replaceAll(`$${id}`, url);
    }

    if (uploadedImages.size !== 0) {
      const placeholders = [...uploadedImages.keys()].map((_, idx) =>
        `($${idx * 2 + 1}, $${idx * 2 + 2})`
      ).join(", ");
      await connection.queryObject(
        `INSERT INTO cached_image_urls (id, url) VALUES ${placeholders} ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url`,
        [...uploadedImages.entries()].flat(),
      );
    }
  } finally {
    connection.release();
  }

  return feedString;
}

async function handler(request: Request): Promise<Response> {
  const { search, pathname } = new URL(request.url);
  switch (pathname) {
    case "/rss": {
      const username = new URLSearchParams(search).get("username");
      if (!username) {
        return new Response("Please specify a username", {
          status: StatusCodes.BAD_REQUEST,
          statusText: ReasonPhrases.BAD_REQUEST,
          headers: {
            "content-type": "text/plain; charset=utf-8",
          },
        });
      }

      const connection = await pool.connect();
      let feed = "";
      try {
        const caches = await connection.queryObject<
          { feed: string; expiration: Date }
        >`
          SELECT feed, expiration FROM cached_rss_feeds WHERE id = ${username.toLowerCase()}
        `;
        if (
          caches.rows.length > 0 && (caches.rows[0].expiration > new Date())
        ) {
          feed = caches.rows[0].feed;
        } else {
          feed = await getRssFeed(username);
          await connection.queryObject`
            INSERT INTO cached_rss_feeds (id, feed) VALUES (${username.toLowerCase()}, ${feed})
            ON CONFLICT (id) DO UPDATE SET feed = ${feed}, expiration = date_round(NOW() + INTERVAL '30 minutes', '30 minutes')
          `;
        }
      } finally {
        connection.release();
      }
      return new Response(feed, {
        status: StatusCodes.OK,
        statusText: ReasonPhrases.OK,
        headers: {
          "content-type": "application/rss+xml; charset=utf-8",
        },
      });
    }
    default: {
      return new Response("Not Found", {
        status: StatusCodes.NOT_FOUND,
        statusText: ReasonPhrases.NOT_FOUND,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }
  }
}

await serve(handler);
