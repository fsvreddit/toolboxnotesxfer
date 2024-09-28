import { Context, FormField, FormOnSubmitEvent, JSONObject, MenuItemOnPressEvent, ScheduledJobEvent, TriggerContext, User, UserNoteLabel } from "@devvit/public-api";
import { AppInstall } from "@devvit/protos";
import { FINISHED_TRANSFER, MAPPING_KEY, NOTES_QUEUE } from "./constants.js";
import { RawSubredditConfig, RawUsernoteType } from "toolbox-devvit/dist/types/RawSubredditConfig.js";
import { mapUsernoteTypesForm } from "./main.js";
import { decompressBlob, ToolboxClient, Usernotes } from "toolbox-devvit";
import { addSeconds, format } from "date-fns";
import { thingIdFromPermalink } from "./utility.js";
import pluralize from "pluralize";
import _ from "lodash";

interface NoteTypeMapping {
    key: string;
    value: UserNoteLabel;
}

interface RedditNativeLabel {
    label: string;
    value: UserNoteLabel;
}

const defaultNoteTypeMapping: NoteTypeMapping[] = [
    { key: "gooduser", value: "HELPFUL_USER" },
    { key: "watch", value: "SPAM_WATCH" },
    { key: "warning", value: "SPAM_WARNING" },
    { key: "abusewarn", value: "ABUSE_WARNING" },
    { key: "ban", value: "BAN" },
    { key: "permban", value: "PERMA_BAN" },
    { key: "bot_ban", value: "BOT_BAN" },
];

const redditNativeLabels: RedditNativeLabel[] = [
    { label: "Bot Ban", value: "BOT_BAN" },
    { label: "Permaban", value: "PERMA_BAN" },
    { label: "Ban", value: "BAN" },
    { label: "Abuse Warning", value: "ABUSE_WARNING" },
    { label: "Spam Warning", value: "SPAM_WARNING" },
    { label: "Spam Watch", value: "SPAM_WATCH" },
    { label: "Solid Contributor", value: "SOLID_CONTRIBUTOR" },
    { label: "Helpful User", value: "HELPFUL_USER" },
];

export async function storeDefaultMappingOnInstall (event: AppInstall, context: TriggerContext) {
    await context.redis.set(MAPPING_KEY, JSON.stringify(defaultNoteTypeMapping));
}

export async function startTransferMenuHandler (_: MenuItemOnPressEvent, context: Context) {
    const notesQueue = await context.redis.zRange(NOTES_QUEUE, 0, -1);
    if (notesQueue.length) {
        context.ui.showToast(`Import is already in progress! ${notesQueue.length} users still to go.`);
        return;
    }

    const finishedTransfer = await context.redis.get(FINISHED_TRANSFER);
    if (finishedTransfer) {
        context.ui.showToast(`A transfer has already been done for this subreddit.`);
    }

    await checkUsernoteTypesMapped(context);
}

async function getToolboxUsernoteTypes (context: TriggerContext): Promise<RawUsernoteType[]> {
    const subreddit = await context.reddit.getCurrentSubreddit();
    const wikiPage = await context.reddit.getWikiPage(subreddit.name, "toolbox");

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
        await startTransfer(context);
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
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

    await startTransfer(context);
}

async function startTransfer (context: Context) {
    const toolbox = new ToolboxClient(context.reddit);
    const subreddit = await context.reddit.getCurrentSubreddit();
    const allUserNotes = await toolbox.getUsernotes(subreddit.name);
    const distinctUsers = Object.keys(decompressBlob(allUserNotes.toJSON().blob));
    if (distinctUsers.length === 0) {
        context.ui.showToast("No usernotes need transferring.");
        return;
    }

    await context.redis.zAdd(NOTES_QUEUE, ...distinctUsers.map(user => ({ member: user, score: 0 })));
    context.ui.showToast(`Queued ${distinctUsers.length} ${pluralize("user", distinctUsers.length)} for processing.`);
    await context.scheduler.runJob({
        name: "TransferUsers",
        runAt: addSeconds(new Date(), 1),
    });
}

async function transferNotesForUser (username: string, subreddit: string, usernotes: Usernotes, noteTypeMapping: NoteTypeMapping[], context: TriggerContext) {
    const usersNotes = usernotes.get(username);
    if (usersNotes.length === 0) {
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

        console.log({
            label: label?.value,
            note: `${usernote.text}, added by ${usernote.moderatorUsername} on ${format(usernote.timestamp, "yyyy-MM-dd")}`,
            redditId,
            subreddit,
            user: username,
        });

        if (label) {
            await context.reddit.addModNote({
                label: label.value,
                note: `${usernote.text}, added by ${usernote.moderatorUsername} on ${format(usernote.timestamp, "yyyy-MM-dd")}`,
                redditId,
                subreddit,
                user: username,
            });
            added++;
        }
    }

    console.log(`Added ${added} mod ${pluralize("note", added)} for ${username}`);
}

export async function transferUserBatch (_: ScheduledJobEvent<undefined>, context: TriggerContext) {
    const queue = await context.redis.zRange(NOTES_QUEUE, 0, 50);
    if (queue.length === 0) {
        console.log("Queue is empty!");
        return;
    }

    const toolbox = new ToolboxClient(context.reddit);
    const subreddit = await context.reddit.getCurrentSubreddit();
    const allUserNotes = await toolbox.getUsernotes(subreddit.name);
    const noteTypeMappingValue = await context.redis.get(MAPPING_KEY);

    let noteTypeMapping: NoteTypeMapping[] = [];
    if (noteTypeMappingValue) {
        noteTypeMapping = JSON.parse(noteTypeMappingValue) as NoteTypeMapping[];
    }

    for (const user of queue.map(queueItem => queueItem.member)) {
        await transferNotesForUser(user, subreddit.name, allUserNotes, noteTypeMapping, context);
        await context.redis.zRem(NOTES_QUEUE, [user]);
    }

    console.log(`Processed ${queue.length} ${pluralize("user", queue.length)}. Queueing further checks`);

    if (queue.length > 0) {
        await context.scheduler.runJob({
            name: "TransferUsers",
            runAt: addSeconds(new Date(), 30),
        });
    } else {
        await context.redis.set(FINISHED_TRANSFER, new Date().getTime().toString());
    }
}
