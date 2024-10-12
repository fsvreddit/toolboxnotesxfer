import { Context, FormField, FormOnSubmitEvent, JobContext, JSONObject, MenuItemOnPressEvent, TriggerContext } from "@devvit/public-api";
import { FINISHED_TRANSFER, MAPPING_KEY, NOTES_QUEUE, NOTES_TRANSFERRED, USERS_TRANSFERRED } from "./constants.js";
import { defaultNoteTypeMapping, finishTransfer, getAllNotes, NoteTypeMapping, redditNativeLabels, transferNotesForUser, usersWithNotesSince } from "./notesTransfer.js";
import { confirmForm, mapUsernoteTypesForm } from "./main.js";
import { addSeconds, formatDate } from "date-fns";
import pluralize from "pluralize";
import { decompressBlob } from "toolbox-devvit";
import { RawSubredditConfig, RawUsernoteType } from "toolbox-devvit/dist/types/RawSubredditConfig.js";
import _ from "lodash";

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
        required: false,
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

export async function transferUserBatch (_: unknown, context: JobContext) {
    const batchSize = 50;
    const queue = await context.redis.zRange(NOTES_QUEUE, 0, batchSize - 1);
    if (queue.length === 0) {
        console.log("Queue is empty!");
        await finishTransfer(context);
        await sendModmail(context);
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

async function sendModmail (context: TriggerContext) {
    const subredditName = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;

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
