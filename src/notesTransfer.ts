import { JobContext, TriggerContext, User, UserNoteLabel, WikiPage, WikiPagePermissionLevel } from "@devvit/public-api";
import { FINISHED_TRANSFER, NOTES_TRANSFERRED, UPDATE_WIKI_PAGE_FLAG, USERS_TRANSFERRED, WIKI_PAGE_NAME } from "./constants.js";
import { format, isSameDay } from "date-fns";
import { decompressBlob, ToolboxClient, Usernotes } from "toolbox-devvit";
import pluralize from "pluralize";

export interface NoteTypeMapping {
    key: string;
    value: UserNoteLabel;
}

export interface RedditNativeLabel {
    label: string;
    value: UserNoteLabel;
}

export const defaultNoteTypeMapping: NoteTypeMapping[] = [
    { key: "gooduser", value: "HELPFUL_USER" },
    { key: "watch", value: "SPAM_WATCH" },
    { key: "spamwatch", value: "SPAM_WATCH" },
    { key: "warning", value: "SPAM_WARNING" },
    { key: "spamwarn", value: "SPAM_WARNING" },
    { key: "abusewarn", value: "ABUSE_WARNING" },
    { key: "ban", value: "BAN" },
    { key: "permban", value: "PERMA_BAN" },
    { key: "botban", value: "BOT_BAN" },
    { key: "bot_ban", value: "BOT_BAN" },
];

export const redditNativeLabels: RedditNativeLabel[] = [
    { label: "Bot Ban", value: "BOT_BAN" },
    { label: "Permaban", value: "PERMA_BAN" },
    { label: "Ban", value: "BAN" },
    { label: "Abuse Warning", value: "ABUSE_WARNING" },
    { label: "Spam Warning", value: "SPAM_WARNING" },
    { label: "Spam Watch", value: "SPAM_WATCH" },
    { label: "Solid Contributor", value: "SOLID_CONTRIBUTOR" },
    { label: "Helpful User", value: "HELPFUL_USER" },
];

export async function getAllNotes (context: TriggerContext): Promise<Usernotes> {
    const toolbox = new ToolboxClient(context.reddit);
    const subredditName = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;
    return await toolbox.getUsernotes(subredditName);
}

export function usersWithNotesSince (allUserNotes: Usernotes, since: Date): string[] {
    const distinctUsers = Object.keys(decompressBlob(allUserNotes.toJSON().blob));

    return distinctUsers.filter(user => allUserNotes.get(user).some(note => note.timestamp > since));
}

export function redditIdFromPermalink (permalink?: string): `t1_${string}` | `t3_${string}` | undefined {
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

export async function transferNotesForUser (username: string, subreddit: string, usernotes: Usernotes, noteTypeMapping: NoteTypeMapping[], transferSince: Date | undefined, context: TriggerContext) {
    let usersNotes = usernotes.get(username);

    if (transferSince) {
        usersNotes = usersNotes.filter(note => note.timestamp > transferSince);
    }

    if (usersNotes.length === 0) {
        // Shouldn't be possible if we got here.
        return;
    }

    let user: User | undefined;
    try {
        user = await context.reddit.getUserByUsername(username);
    } catch {
        //
    }

    if (!user) {
        console.log(`Notes Transfer: User ${username} is deleted, suspended or shadowbanned. Skipping.`);
        return;
    }

    let added = 0;

    for (const usernote of usersNotes) {
        const label = noteTypeMapping.find(x => x.key === usernote.noteType);
        const redditId = redditIdFromPermalink(usernote.contextPermalink);

        let noteText = `${usernote.text}, added by ${usernote.moderatorUsername}`;
        if (!isSameDay(usernote.timestamp, new Date())) {
            noteText += ` on ${format(usernote.timestamp, "yyyy-MM-dd")}`;
        }

        await context.reddit.addModNote({
            label: label?.value,
            note: noteText,
            redditId,
            subreddit,
            user: username,
        });
        added++;
    }

    await context.redis.incrBy(USERS_TRANSFERRED, 1);
    await context.redis.incrBy(NOTES_TRANSFERRED, added);

    console.log(`Notes Transfer: Added ${added} mod ${pluralize("note", added)} for ${username}`);
}

export async function updateWikiPage (_: unknown, context: JobContext) {
    const wikiPageNeedsUpdate = await context.redis.get(UPDATE_WIKI_PAGE_FLAG);
    if (wikiPageNeedsUpdate) {
        await finishTransfer(true, context);
    }
}

export async function finishTransfer (updateWikiPageNow: boolean, context: JobContext) {
    const completedDate = new Date().getTime();
    await context.redis.set(FINISHED_TRANSFER, completedDate.toString());

    if (!updateWikiPageNow) {
        await context.redis.set(UPDATE_WIKI_PAGE_FLAG, "true");
        return;
    }

    const subredditName = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;

    // Store completed date in the wiki, to allow for future incremental updates.
    // It's important not to use Redis here to preserve data if app is uninstalled.
    let wikiPage: WikiPage | undefined;
    try {
        wikiPage = await context.reddit.getWikiPage(subredditName, WIKI_PAGE_NAME);
    } catch {
        //
    }

    const wikiSaveOptions = {
        subredditName,
        page: WIKI_PAGE_NAME,
        content: JSON.stringify({ completedDate }),
        reason: "Storing completion date for transfer",
    };

    if (wikiPage) {
        await context.reddit.updateWikiPage(wikiSaveOptions);
    } else {
        await context.reddit.createWikiPage(wikiSaveOptions);
        await context.reddit.updateWikiPageSettings({
            subredditName,
            page: WIKI_PAGE_NAME,
            listed: false,
            permLevel: WikiPagePermissionLevel.MODS_ONLY,
        });
    }

    await context.redis.del(UPDATE_WIKI_PAGE_FLAG);
}
