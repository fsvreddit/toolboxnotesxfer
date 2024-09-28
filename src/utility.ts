export function thingIdFromPermalink (permalink?: string): `t1_${string}` | `t3_${string}` | undefined {
    if (!permalink) {
        return;
    }

    const regex = /\/comments\/(\w{1,8})\/\w+\/(\w{1,8})?/;
    const matches = regex.exec(permalink);
    if (!matches) {
        return;
    }

    const [, postId, commentId] = matches;

    if (commentId) {
        return `t1_${commentId}`;
    } else if (postId) {
        return `t3_${postId}`;
    }
}
