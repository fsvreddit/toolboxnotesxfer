import { ModAction } from "@devvit/protos";
import { Post, Comment, TriggerContext } from "@devvit/public-api";
import { finishTransfer, NoteTypeMapping, recordSyncStarted } from "./notesTransfer.js";
import { LAST_SYNC_COMPLETED, MAPPING_KEY } from "./constants.js";
import { AppSetting } from "./settings.js";
import { ToolboxClient, UsernoteInit } from "toolbox-devvit";
import { isCommentId, isLinkId } from "@devvit/shared-types/tid.js";
import { addHours, subSeconds } from "date-fns";

export async function handleAddNote (event: ModAction, context: TriggerContext) {
    if (event.action !== "addnote" || !event.subreddit || !event.targetUser || event.moderator?.name === context.appName) {
        return;
    }

    const settings = await context.settings.getAll();
    if (!settings[AppSetting.AutomaticReverseTransfer]) {
        return;
    }

    const usersNotes = await context.reddit.getModNotes({
        subreddit: event.subreddit.name,
        user: event.targetUser.name,
        filter: "NOTE",
        limit: 1,
    }).all();

    if (usersNotes.length === 0) {
        console.log(`Add Note: Didn't find a note`);
        return;
    }

    const [modNote] = usersNotes;

    if (modNote.createdAt < subSeconds(event.actionedAt ?? new Date(), 30)) {
        console.log(`Note is too old.`);
        return;
    }

    if (!modNote.userNote?.note || !modNote.user.name) {
        console.log(`Add Note: Note is not valid (username not recorded or missing usernote)`);
        return;
    }

    const redisKey = `transferredNote~${modNote.id}`;
    const alreadyProcessed = await context.redis.get(redisKey);
    if (alreadyProcessed) {
        return;
    }

    console.log(`Add Note: New mod note for ${modNote.user.name} by ${modNote.operator.name}.`);

    const existingMappingValues = await context.redis.get(MAPPING_KEY);
    const existingMapping: NoteTypeMapping[] = [];
    if (existingMappingValues) {
        existingMapping.push(...(JSON.parse(existingMappingValues) as NoteTypeMapping[]));
    }

    let noteType = existingMapping.find(mapping => mapping.value === modNote.userNote?.label)?.key;
    // Special handling for "Solid Contributor", not part of default mapping.
    if (!noteType && modNote.userNote.label === "SOLID_CONTRIBUTOR" && existingMapping.some(x => x.key === "gooduser")) {
        noteType = "gooduser";
    }

    const newUserNote: UsernoteInit = {
        text: modNote.userNote.note,
        username: modNote.user.name,
        contextPermalink: await getPermalinkFromRedditId(modNote.userNote.redditId, context),
        moderatorUsername: modNote.operator.name,
        noteType,
        timestamp: modNote.createdAt,
    };

    const toolbox = new ToolboxClient(context.reddit);
    await toolbox.addUsernote(event.subreddit.name, newUserNote, `"create new note on ${modNote.user.name}" via Toolbox Notes Transfer`);
    await finishTransfer(context);
    await recordSyncStarted(context);
    await context.redis.set(LAST_SYNC_COMPLETED, new Date().getTime().toString());

    await context.redis.set(redisKey, new Date().getTime.toString(), { expiration: addHours(new Date(), 6) });

    console.log("Add Note: Note saved as a usernote");
}

async function getPermalinkFromRedditId (redditId: string | undefined, context: TriggerContext): Promise<string | undefined> {
    if (!redditId) {
        return;
    }

    let target: Post | Comment | undefined;

    if (isCommentId(redditId)) {
        target = await context.reddit.getCommentById(redditId);
    } else if (isLinkId(redditId)) {
        target = await context.reddit.getPostById(redditId);
    }

    return target?.permalink;
}
