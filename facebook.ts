export type FacebookImage = {
    height: number;
    source: string;
    width: number;
};

export type FacebookImageCollection = {
    images: Array<FacebookImage>;
    id: string;
};

export type FacebookError = {
    error: {
        message: string;
        type: string;
        code: number;
        error_subcode: number;
        fbtrace_id: string;
    };
};

export type FacebookProfilePicture = {
    data: {
        height: number;
        width: number;
        is_silhouette: boolean;
        url: string;
    };
};

type FacebookPhotoishAttachment =
    & (
        | { type: "photo"; description: string }
        | { type: "cover_photo"; title: string }
    )
    & {
        target: {
            id: string;
            url: string;
        };
        media: {
            image: {
                height: number;
                width: number;
                src: string;
            };
        };
    };

type FacebookVideoAttachment = {
    type: "video_direct_response_autoplay" | "video_autoplay";
    title?: string;
    url: string;
    target: {
        id: string;
        url: string;
    };
    media: {
        image: {
            height: number;
            width: number;
            src: string;
        };
        source: string;
    };
};

type FacebookIndividiualAttachment =
    | FacebookPhotoishAttachment
    | FacebookVideoAttachment;

type FacebookAlbumAttachment = {
    type: "album";
    title: string;
    subattachments: {
        data: Array<FacebookIndividiualAttachment>;
    };
    target: {
        id: string;
        url: string;
    };
    media: {
        image: {
            height: number;
            width: number;
            src: string;
        };
    };
};

export type FacebookPostAttachment =
    | FacebookIndividiualAttachment
    | FacebookAlbumAttachment;

export type FacebookPost = {
    id: string;
    created_time: string;
    message?: string;
    story?: string;
    permalink_url: string;
    attachments?: {
        data: Array<FacebookPostAttachment>;
    };
};

export type FacebookPaginationResult<T> = {
    data: Array<T>;
    paging: {
        cursors: {
            before: string;
            after: string;
        };
        next: string;
    };
};

export type FacebookProfile = {
    name: string;
    about: string;
    link: string;
    picture: FacebookProfilePicture;
    posts: FacebookPaginationResult<FacebookPost>;
    id: string;
};
