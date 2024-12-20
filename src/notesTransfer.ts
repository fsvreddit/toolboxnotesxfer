import { CreateModNoteOptions, JobContext, TriggerContext, User, UserNoteLabel } from "@devvit/public-api";
import { BULK_FINISHED, FINISHED_TRANSFER, NOTES_ERRORED, NOTES_TRANSFERRED, SYNC_STARTED, TRANSFER_USERS_JOB, UPDATE_WIKI_PAGE_FLAG, USERS_SKIPPED, USERS_TRANSFERRED } from "./constants.js";
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

export async function getAllNotes (context: TriggerContext): Promise<Usernotes | undefined> {
    const subredditName = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;
    const toolbox = new ToolboxClient(context.reddit);
    try {
        return await toolbox.getUsernotes(subredditName);
    } catch {
        return;
    }
}

export function usersWithNotesInScope (allUserNotes: Usernotes | undefined, since?: Date, until?: Date): string[] {
    if (!allUserNotes) {
        return [];
    }

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

export async function transferNotesForUser (username: string, subreddit: string, usernotes: Usernotes | undefined, noteTypeMapping: NoteTypeMapping[], timeFrom: Date | undefined, timeTo: Date | undefined, context: TriggerContext) {
    if (!usernotes) {
        return;
    }
    let usersNotes = usernotes.get(username);

    if (timeFrom) {
        usersNotes = usersNotes.filter(note => note.timestamp > timeFrom);
    }

    if (timeTo) {
        usersNotes = usersNotes.filter(note => note.timestamp < timeTo);
    }

    if (usersNotes.length === 0) {
        // Shouldn't be possible if we got here.
        console.log(`Notes Transfer: No notes found for ${username}`);
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
        await context.redis.incrBy(USERS_SKIPPED, 1);
        return;
    }

    let added = 0;
    let errored = 0;

    for (const usernote of usersNotes.sort((a, b) => a.timestamp > b.timestamp ? 1 : -1)) {
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
        } catch (error) {
            // I don't expect any of these to fail, but increment count anyway.
            errored++;
            console.log(`Error transferring note ${JSON.stringify(noteContent)}`);
            console.log(error);
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
        await finishTransfer(context, true);
    }
}

export async function finishTransfer (context: JobContext, updateWikiPageNow?: boolean, cancelJobs?: boolean) {
    if (cancelJobs) {
        const currentJobs = await context.scheduler.listJobs();
        const transferJobs = currentJobs.filter(job => job.name === TRANSFER_USERS_JOB);
        await Promise.all(transferJobs.map(job => context.scheduler.cancelJob(job.id)));
    }

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
