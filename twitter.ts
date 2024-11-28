type SyndicationContextProvider = {
    features: Record<string, unknown>;
    scribeData: {
        client_version: unknown | null;
        dnt: boolean;
        widget_id: string;
        widget_origin: string;
        widget_frame: string;
        widget_partner: string;
        widget_site_screen_name: string;
        widget_site_user_id: string;
        widget_creator_screen_name: string;
        widget_creator_user_id: string;
        widget_iframe_version: string;
        widget_data_source: string;
        session_id: string;
    };
    messengerContext: {
        embedId: string;
    };
    hasResults: boolean;
    lang: string;
    theme: "light" | "dark";
};

type SyndicationUrlEntity = {
    display_url: string;
    expanded_url: string;
    url: string;
    indices: [number, number];
};

type SyndicationHashtagEntity = {
    indices: [number, number];
    text: string;
};

type SyndicationMediaSize = {
    h: number;
    w: number;
    resize: "fit" | "crop";
};

type MediaRect = Record<"x" | "y" | "w" | "h", number>;

type SyndicationMediaFeature = {
    faces: Array<MediaRect>;
};

type SyndicationMediaEntity = {
    display_url: string;
    expanded_url: string;
    id_str: string;
    indices: [number, number];
    media_key: string;
    media_url_https: string;
    url: string;
    ext_media_availability: {
        status: string;
    };
    sizes: Record<"large" | "medium" | "small" | "thumb", SyndicationMediaSize>;
    original_info: {
        height: number;
        width: number;
        focus_rects: Array<MediaRect>;
    };
};

type SyndicationPhotoEntity = SyndicationMediaEntity & {
    type: "photo";
    features: Record<"large" | "medium" | "small" | "orig", SyndicationMediaFeature>;
};

type SyndicationVideoEntity = SyndicationMediaEntity & {
    type: "video";
    additional_media_info: {
        description: string;
        embeddable: boolean;
        monetizable: boolean;
        title: string;
    };
    video_info: {
        aspect_ratio: [number, number];
        duration_millis: number;
        variants: Array<{
            bitrate?: number;
            content_type: string;
            url: string;
        }>;
    };
};

type SyndicationUser = {
    blocking: boolean;
    created_at: string;
    default_profile: boolean;
    default_profile_image: boolean;
    description: string;
    entities: {
        description?: {
            urls?: Array<SyndicationUrlEntity>;
        };
        url?: {
            urls?: Array<SyndicationUrlEntity>;
        };
    };
    fast_followers_count: number;
    favourites_count: number;
    follow_request_sent: boolean;
    followed_by: boolean;
    followers_count: number;
    following: boolean;
    friends_count: number;
    has_custom_timelines: boolean;
    id: 0;
    id_str: string;
    is_translator: boolean;
    listed_count: number;
    location: string;
    media_count: number;
    name: string;
    normal_followers_count: number;
    notifications: boolean;
    profile_banner_url: string;
    profile_image_url_https: string;
    protected: boolean;
    screen_name: string;
    show_all_inline_media: boolean;
    statuses_count: number;
    time_zone: string;
    translator_type: string;
    url: string;
    utc_offset: number;
    verified: boolean;
    verified_type: string;
    withheld_in_countries: Array<string>;
    withheld_scope: string;
    is_blue_verified: boolean;
};

type SyndicationTweet = {
    id: 0;
    location: string;
    conversation_id_str: string;
    created_at: string;
    display_text_range: [number, number];
    entities: {
        user_mentions: Array<unknown>;
        symbols: Array<unknown>;
        urls: Array<SyndicationUrlEntity>;
        hashtags: Array<SyndicationHashtagEntity>;
        media: Array<SyndicationPhotoEntity | SyndicationVideoEntity>;
    };
    extended_entities: {
        media: Array<SyndicationPhotoEntity | SyndicationVideoEntity>;
    };
    favorite_count: number;
    favorited: boolean;
    full_text: string;
    id_str: string;
    lang: string;
    permalink: string;
    possibly_sensitive: boolean;
    quote_count: number;
    reply_count: number;
    retweet_count: number;
    retweeted: boolean;
    text: string;
    user: SyndicationUser;
    retweeted_status?: SyndicationTweet;
};

type SyndicationTimelineEntry = {
    type: "tweet";
    entry_id: string;
    sort_index: string;
    content: {
        tweet: SyndicationTweet;
    };
};

type SyndicationTimeline = {
    entries: Array<SyndicationTimelineEntry>;
};

export type SyndicationProps = {
    contextProvider: SyndicationContextProvider;
    lang: string;
    maxHeight: number | null;
    showHeader: boolean;
    hideBorder: boolean;
    hideFooter: boolean;
    hideScrollBar: boolean;
    transparent: boolean;
    timeline: SyndicationTimeline;
    latest_tweet_id: string;
    headerProps: {
        screenName: string;
    };
};

export type NextData<T> = {
    props: {
        pageProps: T;
    };
    page: string;
    query: Record<string, string>;
    buildId: string;
    assetPrefix: string;
    isFallback: boolean;
    gssp: boolean;
    customServer: boolean;
    scriptLoader: Array<unknown>;
};
