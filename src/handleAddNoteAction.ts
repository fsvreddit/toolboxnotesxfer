import { ModAction } from "@devvit/protos";
import { TriggerContext } from "@devvit/public-api";
import { defaultNoteTypeMapping, NoteTypeMapping } from "./notesTransfer.js";
import { FINISHED_TRANSFER, MAPPING_KEY } from "./constants.js";
import { ToolboxClient, UsernoteInit } from "toolbox-devvit";
import { isCommentId, isLinkId } from "@devvit/shared-types/tid.js";
import { AppSetting } from "./settings.js";

export async function handleAddNote (event: ModAction, context: TriggerContext) {
    if (event.action !== "addnote" || !event.subreddit || !event.targetUser || event.moderator?.name === context.appName) {
        return;
    }

    const settings = await context.settings.getAll();
    if (!settings[AppSetting.AutomaticReverseTransfer]) {
        return;
    }

    const transferCompleteVal = await context.redis.get(FINISHED_TRANSFER);
    if (!transferCompleteVal) {
        return;
    }

    const subredditName = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;
    const usersNotes = await context.reddit.getModNotes({
        subreddit: subredditName,
        user: event.targetUser.name,
        limit: 1,
    }).all();

    if (usersNotes.length === 0) {
        return;
    }

    const [modNote] = usersNotes;
    if (modNote.type !== "NOTE" || !modNote.userNote?.note || !modNote.user.name) {
        // Not a valid mod note.
        return;
    }

    console.log(`New mod note added on ${modNote.user.name}. Transferring back to Toolbox.`);

    const existingMappingValues = await context.redis.get(MAPPING_KEY);
    const existingMapping: NoteTypeMapping[] = [];
    if (existingMappingValues) {
        existingMapping.push(...(JSON.parse(existingMappingValues) as NoteTypeMapping[]));
    } else {
        existingMapping.push(...defaultNoteTypeMapping);
        await context.redis.set(MAPPING_KEY, JSON.stringify(existingMapping));
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
    await toolbox.addUsernote(subredditName, newUserNote, `"create new note on ${modNote.user.name}" via Toolbox Notes Transfer`);
}

async function getPermalinkFromRedditId (redditId: string | undefined, context: TriggerContext) {
    if (!redditId) {
        return;
    }

    if (isCommentId(redditId)) {
        const comment = await context.reddit.getCommentById(redditId);
        return comment.permalink;
    }

    if (isLinkId(redditId)) {
        const post = await context.reddit.getPostById(redditId);
        return post.permalink;
    }
}