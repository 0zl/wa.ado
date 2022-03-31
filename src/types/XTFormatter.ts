export interface XTMessages {
    ts: number
    authorId: string
    threadId: string
    messages: {
        text: string | null
        attachment: {
            type: string
            mime: string
            size: number
            meta: {
                width: number
                height: number
                url: string
            };
            raw: any
        } | null
    } | null,
    raw: any
}