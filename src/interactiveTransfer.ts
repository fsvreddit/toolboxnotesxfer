import { Context, FormField, FormOnSubmitEvent, JobContext, JSONObject, MenuItemOnPressEvent, TriggerContext } from "@devvit/public-api";
import { BULK_FINISHED, DEFAULT_USERNOTE_TYPES, FINISHED_TRANSFER, MAPPING_KEY, NOTES_ERRORED, NOTES_QUEUE, NOTES_TRANSFERRED, SYNC_STARTED, TRANSFER_USERS_CRON, TRANSFER_USERS_JOB, USERS_SKIPPED, USERS_TRANSFERRED } from "./constants.js";
import { finishTransfer, getAllNotes, NoteTypeMapping, recordBulkFinished, redditNativeLabels, transferNotesForUser, usersWithNotesInScope } from "./notesTransfer.js";
import { confirmForm, mapUsernoteTypesForm } from "./main.js";
import { AppSetting } from "./settings.js";
import pluralize from "pluralize";
import { RawUsernoteType } from "toolbox-devvit/dist/types/RawSubredditConfig.js";
import _ from "lodash";
import { ToolboxClient } from "toolbox-devvit";
import { SubredditConfig } from "toolbox-devvit/dist/classes/SubredditConfig.js";

export async function startTransferMenuHandler (_: MenuItemOnPressEvent, context: Context) {
    const notesQueueLength = await context.redis.zCard(NOTES_QUEUE);
    if (notesQueueLength) {
        context.ui.showToast(`Import is already in progress! ${notesQueueLength} users still to go.`);

        // Check if jobs are queued. If not, requeue.
        const jobs = await context.scheduler.listJobs();
        if (!jobs.some(job => job.name === TRANSFER_USERS_JOB)) {
            await context.scheduler.runJob({
                name: TRANSFER_USERS_JOB,
                cron: TRANSFER_USERS_CRON,
            });
            console.log("Interactive Transfer: Job was missing, and has been rescheduled");
        }
        return;
    }

    const [transferCompleteVal, bulkFinishedVal] = await Promise.all([
        context.redis.get(FINISHED_TRANSFER),
        context.redis.get(BULK_FINISHED),
    ]);

    if (transferCompleteVal && bulkFinishedVal) {
        const settings = await context.settings.getAll();
        if (settings[AppSetting.AutomaticForwardTransfer] || settings[AppSetting.AutomaticReverseTransfer]) {
            context.ui.showToast("This app is now in synchronisation mode. Further manual transfers cannot be done at this time.");
            return;
        }
    }

    await checkUsernoteTypesMapped(context);
}

export async function getToolboxUsernoteTypes (context: TriggerContext): Promise<RawUsernoteType[]> {
    const subredditName = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;
    const toolbox = new ToolboxClient(context.reddit);
    let subConfig: SubredditConfig;
    try {
        subConfig = await toolbox.getConfig(subredditName);
    } catch {
        console.log("Could not retrieve Toolbox note types, config page may not exist. Returning default set.");
        return DEFAULT_USERNOTE_TYPES;
    }

    return subConfig.getAllNoteTypes();
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
    }

    // Are all user note labels mapped?
    if (usernoteTypes.every(type => existingMapping.some(x => x.key === type.key))) {
        await showConfirmationForm(context);
        return;
    }

    const fields: FormField[] = usernoteTypes.map(type => ({
        name: type.key,
        label: type.text,
        type: "select",
        options: redditNativeLabels,
        defaultValue: getMapping(type.key, existingMapping),
        multiSelect: false,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = { fields, title: "Please choose mappings for Usernote types" };

    context.ui.showForm(mapUsernoteTypesForm, data);
}

export async function mapUsernoteTypesFormHandler (event: FormOnSubmitEvent<JSONObject>, context: Context) {
    const values = event.values as Record<string, [string]>;
    const mappings = _.toPairs(values).map(mapping => ({ key: mapping[0], value: mapping[1][0] } as NoteTypeMapping));

    // Save mappings.
    await context.redis.set(MAPPING_KEY, JSON.stringify(mappings));

    await showConfirmationForm(context);
}

async function showConfirmationForm (context: Context) {
    const [lastFinishedTimeVal, bulkFinishedVal] = await Promise.all([
        context.redis.get(FINISHED_TRANSFER),
        context.redis.get(BULK_FINISHED),
    ]);

    const timeFrom = lastFinishedTimeVal && bulkFinishedVal ? new Date(parseInt(lastFinishedTimeVal)) : undefined;

    const firstSyncVal = await context.redis.get(SYNC_STARTED);
    const timeTo = firstSyncVal ? new Date(parseInt(firstSyncVal)) : undefined;

    const allUserNotes = await getAllNotes(context);
    const distinctUsers = usersWithNotesInScope(allUserNotes, timeFrom, timeTo);
    if (distinctUsers.length === 0) {
        context.ui.showToast("No usernotes need transferring.");
        return;
    }

    const confirmationMessage = `There ${pluralize("is", distinctUsers.length)} ${distinctUsers.length} ${pluralize("user", distinctUsers.length)} with notes available to transfer. Do you want to proceed with transfer?`;

    context.ui.showForm(confirmForm, { description: confirmationMessage });
}

export async function startTransfer (_: FormOnSubmitEvent<JSONObject>, context: Context) {
    const [lastFinishedTimeVal, bulkFinishedVal] = await Promise.all([
        context.redis.get(FINISHED_TRANSFER),
        context.redis.get(BULK_FINISHED),
    ]);

    const timeFrom = lastFinishedTimeVal && bulkFinishedVal ? new Date(parseInt(lastFinishedTimeVal)) : undefined;

    const firstSyncVal = await context.redis.get(SYNC_STARTED);
    const timeTo = firstSyncVal ? new Date(parseInt(firstSyncVal)) : undefined;

    const allUserNotes = await getAllNotes(context);
    const distinctUsers = usersWithNotesInScope(allUserNotes, timeFrom, timeTo);

    if (distinctUsers.length === 0) {
        // Should be impossible unless notes have been deleted since the last step.
        context.ui.showToast("There are no new usernotes available to transfer");
        return;
    }

    context.ui.showToast("Notes will now be transferred in the background. A modmail will be sent on completion.");

    await context.redis.zAdd(NOTES_QUEUE, ...distinctUsers.map(user => ({ member: user, score: 0 })));
    await context.scheduler.runJob({
        name: TRANSFER_USERS_JOB,
        cron: TRANSFER_USERS_CRON,
    });
    console.log("Interactive Transfer: Job scheduled.");
}

export async function transferUserBatch (_: unknown, context: JobContext) {
    const batchSize = 75;
    const queue = await context.redis.zRange(NOTES_QUEUE, 0, batchSize - 1);
    if (queue.length === 0) {
        console.log("Interactive Transfer: Queue is empty!");
        await finishTransfer(context, true, true);
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
    const timeFrom = lastFinishedTimeVal ? new Date(parseInt(lastFinishedTimeVal)) : undefined;

    const firstSyncVal = await context.redis.get(SYNC_STARTED);
    const timeTo = firstSyncVal ? new Date(parseInt(firstSyncVal)) : undefined;

    console.log(`Interactive Transfer: Processing patch with range ${timeFrom} to ${timeTo}`);

    const subredditName = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;
    for (const user of queue.map(queueItem => queueItem.member)) {
        await transferNotesForUser(user, subredditName, allUserNotes, noteTypeMapping, timeFrom, timeTo, context);
        await context.redis.zRem(NOTES_QUEUE, [user]);
    }

    console.log(`Interactive Transfer: Processed ${queue.length} ${pluralize("user", queue.length)}. Queueing further checks`);

    if (queue.length < batchSize) {
        // This was the last batch.
        console.log("Interactive Transfer: Finished transfer!");
        await finishTransfer(context, true, true);
        await sendModmail(context);
    }

    // Duplicate job mitigation: Check for more than one and cancel extra instances.
    const currentJobs = (await context.scheduler.listJobs()).filter(job => job.name === TRANSFER_USERS_JOB);
    if (currentJobs.length > 1) {
        const jobsToCancel = currentJobs.slice(1);
        await Promise.all(jobsToCancel.map(job => context.scheduler.cancelJob(job.id)));
        console.log(`Interactive Transfer: Cancelled ${jobsToCancel.length} rogue ${pluralize("job", jobsToCancel.length)}`);
    }
}

async function sendModmail (context: TriggerContext) {
    const subredditName = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;

    const [notesTransferredVal, usersTransferredVal, usersSkippedVal] = await Promise.all([
        context.redis.get(NOTES_TRANSFERRED),
        context.redis.get(USERS_TRANSFERRED),
        context.redis.get(USERS_SKIPPED),
    ]);

    let message = "All Toolbox usernotes have been transferred to Mod Notes.\n\n";

    if (notesTransferredVal && usersTransferredVal) {
        const notesTransferred = parseInt(notesTransferredVal);
        const usersTransferred = parseInt(usersTransferredVal);
        message += `${notesTransferred.toLocaleString()} ${pluralize("note", notesTransferred)} ${pluralize("was", notesTransferred)} transferred for ${usersTransferred.toLocaleString()} ${pluralize("user", usersTransferred)}\n\n`;

        const notesErroredVal = await context.redis.get(NOTES_ERRORED);
        let notesErrored: number | undefined;
        if (notesErroredVal) {
            notesErrored = parseInt(notesErroredVal);
            message += `${notesErrored.toLocaleString()} ${pluralize("note", notesErrored)} failed to transfer.\n\n`;
        }
    } else {
        message += "No notes were found to transfer.\n\n";
    }

    if (usersSkippedVal) {
        const usersSkipped = parseInt(usersSkippedVal);
        message += `Notes were transferred for active users only. Notes for ${usersSkipped.toLocaleString()} suspended, shadowbanned or deleted ${pluralize("user", usersSkipped)} were not transferred.\n\n`;
    }

    const settings = await context.settings.getAll();
    if (!settings[AppSetting.AutomaticForwardTransfer] && !settings[AppSetting.AutomaticReverseTransfer]) {
        message += "Did you know? This app can do bidirectional synchronisation of new notes between Toolbox and native Mod Notes.";
        message += ` If you would find this useful, you can enable it [here](https://developers.reddit.com/r/${subredditName}/apps/toolboxnotesxfer).\n\n`;
    }

    await context.reddit.modMail.createModInboxConversation({
        subject: "Toolbox usernotes transfer has completed!",
        bodyMarkdown: message,
        subredditId: context.subredditId,
    });

    console.log("Interactive Transfer: Modmail sent.");

    await Promise.all([
        context.redis.del(USERS_TRANSFERRED),
        context.redis.del(NOTES_TRANSFERRED),
        context.redis.del(NOTES_ERRORED),
        context.redis.del(USERS_SKIPPED),
    ]);

    await recordBulkFinished(context);
}
