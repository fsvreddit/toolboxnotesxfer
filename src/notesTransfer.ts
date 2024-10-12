import { Context, FormField, FormOnSubmitEvent, JobContext, JSONObject, MenuItemOnPressEvent, TriggerContext, User, UserNoteLabel, WikiPage, WikiPagePermissionLevel } from "@devvit/public-api";
import { defaultNoteTypeMapping, FINISHED_TRANSFER, MAPPING_KEY, NOTES_QUEUE, NOTES_TRANSFERRED, redditNativeLabels, USERS_TRANSFERRED, WIKI_PAGE_NAME } from "./constants.js";
import { RawSubredditConfig, RawUsernoteType } from "toolbox-devvit/dist/types/RawSubredditConfig.js";
import { confirmForm, mapUsernoteTypesForm } from "./main.js";
import { addSeconds, format, formatDate } from "date-fns";
import { thingIdFromPermalink } from "./utility.js";
import { decompressBlob, ToolboxClient, Usernotes } from "toolbox-devvit";
import pluralize from "pluralize";
import _ from "lodash";

export interface NoteTypeMapping {
    key: string;
    value: UserNoteLabel;
}

export interface RedditNativeLabel {
    label: string;
    value: UserNoteLabel;
}

export async function startTransferMenuHandler (_: MenuItemOnPressEvent, context: Context) {
    const notesQueueLength = await context.redis.zCard(NOTES_QUEUE);
    if (notesQueueLength) {
        context.ui.showToast(`Import is already in progress! ${notesQueueLength} users still to go.`);
        return;
    }

    await checkUsernoteTypesMapped(context);
}

async function getToolboxUsernoteTypes (context: TriggerContext): Promise<RawUsernoteType[]> {
    const subredditName = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;
    const wikiPage = await context.reddit.getWikiPage(subredditName, "toolbox");

    const toolboxConfig = JSON.parse(wikiPage.content) as RawSubredditConfig;

    return toolboxConfig.usernoteColors;
}

function getMapping (type: string, mappings: NoteTypeMapping[]): string[] | undefined {
    const mapping = mappings.find(mapping => mapping.key === type);
    if (mapping) {
        return [mapping.value];
    }
}

async function checkUsernoteTypesMapped (context: Context) {
    let usernoteTypes: RawUsernoteType[] | undefined;
    try {
        usernoteTypes = await getToolboxUsernoteTypes(context);
    } catch {
        context.ui.showToast("Toolbox config wiki page was not found.");
        return;
    }

    const existingMappingValues = await context.redis.get(MAPPING_KEY);
    const existingMapping: NoteTypeMapping[] = [];
    if (existingMappingValues) {
        existingMapping.push(...(JSON.parse(existingMappingValues) as NoteTypeMapping[]));
    } else {
        existingMapping.push(...defaultNoteTypeMapping);
        await context.redis.set(MAPPING_KEY, JSON.stringify(existingMapping));
    }

    // Are all user note labels mapped?
    if (usernoteTypes.every(type => existingMapping.some(x => x.key === type.key))) {
        await showConfirmationForm(context);
        return true;
    }

    const fields: FormField[] = usernoteTypes.map(type => ({
        name: type.key,
        label: type.text,
        type: "select",
        options: redditNativeLabels,
        defaultValue: getMapping(type.key, existingMapping),
        multiSelect: false,
        required: true,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = { fields, title: "Please choose mappings for Usernote types" };

    context.ui.showForm(mapUsernoteTypesForm, data);

    return false;
}

export async function mapUsernoteTypesFormHandler (event: FormOnSubmitEvent<JSONObject>, context: Context) {
    const values = event.values as Record<string, [string]>;
    const mappings = _.toPairs(values).map(mapping => ({ key: mapping[0], value: mapping[1][0] } as NoteTypeMapping));
    const usernoteTypes = await getToolboxUsernoteTypes(context);

    // This shouldn't be necessary, but shreddit has a bug that means that required fields are actually treated as optional.
    if (usernoteTypes.some(type => !mappings.some(mapping => mapping.key === type.key))) {
        context.ui.showToast("Sorry, you need to map all note types before you can proceed.");
        return;
    }

    // Save mappings.
    await context.redis.set(MAPPING_KEY, JSON.stringify(mappings));

    await showConfirmationForm(context);
}

export async function getAllNotes (context: TriggerContext): Promise<Usernotes> {
    const toolbox = new ToolboxClient(context.reddit);
    const subredditName = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;
    return await toolbox.getUsernotes(subredditName);
}

export function usersWithNotesSince (allUserNotes: Usernotes, since: Date): string[] {
    const distinctUsers = Object.keys(decompressBlob(allUserNotes.toJSON().blob));

    return distinctUsers.filter(user => allUserNotes.get(user).some(note => note.timestamp > since));
}

async function showConfirmationForm (context: Context) {
    const allUserNotes = await getAllNotes(context);
    let distinctUsers = Object.keys(decompressBlob(allUserNotes.toJSON().blob));
    if (distinctUsers.length === 0) {
        context.ui.showToast("No usernotes need transferring.");
        return;
    }

    let confirmationMessage: string | undefined;

    const lastFinishedTimeVal = await context.redis.get(FINISHED_TRANSFER);
    if (lastFinishedTimeVal) {
        // We've done a transfer before.
        const timeFinished = new Date(parseInt(lastFinishedTimeVal));
        distinctUsers = usersWithNotesSince(allUserNotes, timeFinished);
        if (distinctUsers.length === 0) {
            context.ui.showToast(`There are no new usernotes since the last transfer on ${formatDate(timeFinished, "yyyy-MM-dd")}`);
            return;
        }
        confirmationMessage = `There ${pluralize("is", distinctUsers.length)} ${distinctUsers.length} ${pluralize("user", distinctUsers.length)} with notes made since the last transfer on ${formatDate(timeFinished, "yyyy-MM-dd")}. Do you want to proceed with transfer?`;
    } else {
        confirmationMessage = `There ${pluralize("is", distinctUsers.length)} ${distinctUsers.length} ${pluralize("user", distinctUsers.length)} with notes. Do you want to proceed with transfer?`;
    }

    context.ui.showForm(confirmForm, { description: confirmationMessage });
}

export async function startTransfer (_: FormOnSubmitEvent<JSONObject>, context: Context) {
    const allUserNotes = await getAllNotes(context);
    let distinctUsers = Object.keys(decompressBlob(allUserNotes.toJSON().blob));

    const lastFinishedTimeVal = await context.redis.get(FINISHED_TRANSFER);
    if (lastFinishedTimeVal) {
        // We've done a transfer before.
        const timeFinished = new Date(parseInt(lastFinishedTimeVal));
        distinctUsers = usersWithNotesSince(allUserNotes, timeFinished);
        if (distinctUsers.length === 0) {
            // Should be impossible unless notes have been deleted since the last step.
            context.ui.showToast(`There are no new usernotes since the last transfer on ${formatDate(timeFinished, "yyyy-MM-dd")}`);
            return;
        }
    }

    context.ui.showToast("Notes will now be transferred in the background. A modmail will be sent on completion.");

    await context.redis.zAdd(NOTES_QUEUE, ...distinctUsers.map(user => ({ member: user, score: 0 })));
    await context.scheduler.runJob({
        name: "TransferUsers",
        runAt: addSeconds(new Date(), 1),
    });
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
        console.log(`User ${username} is deleted, suspended or shadowbanned. Skipping.`);
        return;
    }

    let added = 0;

    for (const usernote of usersNotes) {
        const label = noteTypeMapping.find(x => x.key === usernote.noteType);
        const redditId = thingIdFromPermalink(usernote.contextPermalink);

        await context.reddit.addModNote({
            label: label?.value,
            note: `${usernote.text}, added by ${usernote.moderatorUsername} on ${format(usernote.timestamp, "yyyy-MM-dd")}`,
            redditId,
            subreddit,
            user: username,
        });
        added++;
    }

    await context.redis.incrBy(USERS_TRANSFERRED, 1);
    await context.redis.incrBy(NOTES_TRANSFERRED, added);

    console.log(`Added ${added} mod ${pluralize("note", added)} for ${username}`);
}

export async function transferUserBatch (_: unknown, context: JobContext) {
    const batchSize = 50;
    const queue = await context.redis.zRange(NOTES_QUEUE, 0, batchSize - 1);
    if (queue.length === 0) {
        console.log("Queue is empty!");
        await finishTransfer(true, context);
        return;
    }

    const allUserNotes = await getAllNotes(context);
    const noteTypeMappingValue = await context.redis.get(MAPPING_KEY);

    let noteTypeMapping: NoteTypeMapping[] = [];
    if (noteTypeMappingValue) {
        noteTypeMapping = JSON.parse(noteTypeMappingValue) as NoteTypeMapping[];
    }

    const lastFinishedTimeVal = await context.redis.get(FINISHED_TRANSFER);
    let transferSince: Date | undefined;
    if (lastFinishedTimeVal) {
        transferSince = new Date(parseInt(lastFinishedTimeVal));
    }

    const subredditName = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;
    for (const user of queue.map(queueItem => queueItem.member)) {
        await transferNotesForUser(user, subredditName, allUserNotes, noteTypeMapping, transferSince, context);
        await context.redis.zRem(NOTES_QUEUE, [user]);
    }

    console.log(`Processed ${queue.length} ${pluralize("user", queue.length)}. Queueing further checks`);

    await context.scheduler.runJob({
        name: "TransferUsers",
        runAt: addSeconds(new Date(), 30),
    });
}

export async function finishTransfer (sendModmail: boolean, context: JobContext) {
    const completedDate = new Date().getTime();
    await context.redis.set(FINISHED_TRANSFER, new Date().getTime().toString());

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

    if (!sendModmail) {
        return;
    }

    const notesTransferredVal = await context.redis.get(NOTES_TRANSFERRED);
    const usersTransferredVal = await context.redis.get(USERS_TRANSFERRED);

    let message = "All Toolbox usernotes have been transferred to Mod Notes.\n\n";

    if (notesTransferredVal && usersTransferredVal) {
        const notesTransferred = parseInt(notesTransferredVal);
        const usersTransferred = parseInt(usersTransferredVal);
        message += `${notesTransferred} ${pluralize("note", notesTransferred)} ${pluralize("was", notesTransferred)} transferred for ${usersTransferred} ${pluralize("user", usersTransferred)}\n\n`;
    } else {
        message += "No notes were found to transfer.\n\n";
    }

    message += "Notes were transferred for active users only. Notes for suspended, shadowbanned or deleted users were not transferred.\n\n";

    await context.reddit.sendPrivateMessage({
        to: `/r/${subredditName}`,
        subject: "Toolbox usernotes transfer has completed!",
        text: message,
    });

    console.log("Modmail sent.");
}
