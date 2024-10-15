import { CreateModNoteOptions, JobContext, TriggerContext, User, UserNoteLabel } from "@devvit/public-api";
import { BULK_FINISHED, FINISHED_TRANSFER, NOTES_ERRORED, NOTES_TRANSFERRED, SYNC_STARTED, UPDATE_WIKI_PAGE_FLAG, USERS_TRANSFERRED } from "./constants.js";
import { saveWikiPage } from "./wikiPage.js";
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

export function usersWithNotesInScope (allUserNotes: Usernotes, since?: Date, until?: Date): string[] {
    const distinctUsers = Object.keys(decompressBlob(allUserNotes.toJSON().blob));

    return distinctUsers.filter(user => allUserNotes.get(user).some(note => (!since || note.timestamp > since) && (!until || note.timestamp < until)));
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

export async function transferNotesForUser (username: string, subreddit: string, usernotes: Usernotes, noteTypeMapping: NoteTypeMapping[], timeFrom: Date | undefined, timeTo: Date | undefined, context: TriggerContext) {
    let usersNotes = usernotes.get(username);

    if (timeFrom) {
        usersNotes = usersNotes.filter(note => note.timestamp > timeFrom);
    }

    if (timeTo) {
        usersNotes = usersNotes.filter(note => note.timestamp < timeTo);
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
    let errored = 0;

    for (const usernote of usersNotes) {
        const label = noteTypeMapping.find(x => x.key === usernote.noteType);
        const redditId = redditIdFromPermalink(usernote.contextPermalink);

        let noteText = `${usernote.text}, added by ${usernote.moderatorUsername}`;
        if (!isSameDay(usernote.timestamp, new Date())) {
            noteText += ` on ${format(usernote.timestamp, "yyyy-MM-dd")}`;
        }

        const noteContent: CreateModNoteOptions = {
            label: label?.value,
            note: noteText,
            redditId,
            subreddit,
            user: username,
        };

        try {
            await context.reddit.addModNote(noteContent);
            added++;
        } catch {
            // I don't expect any of these to fail, but increment count anyway.
            errored++;
        }
    }

    await context.redis.incrBy(USERS_TRANSFERRED, 1);
    await context.redis.incrBy(NOTES_TRANSFERRED, added);
    if (errored) {
        await context.redis.incrBy(NOTES_ERRORED, errored);
    }

    let output = `Notes Transfer: Added ${added} mod ${pluralize("note", added)} for ${username}`;
    if (errored) {
        output += `. Errored: ${errored}`;
    }

    console.log(output);
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

    await saveWikiPage(context);
}

async function recordDateValueIfNotExists (key: string, context: TriggerContext) {
    const alreadyRecorded = await context.redis.get(key);
    if (!alreadyRecorded) {
        await context.redis.set(key, new Date().getTime().toString());
    }
}

export async function recordSyncStarted (context: TriggerContext) {
    await recordDateValueIfNotExists(SYNC_STARTED, context);
}

export async function recordBulkFinished (context: TriggerContext) {
    await recordDateValueIfNotExists(BULK_FINISHED, context);
}
