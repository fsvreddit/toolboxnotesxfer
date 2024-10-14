import { ModAction } from "@devvit/protos";
import { TriggerContext } from "@devvit/public-api";
import { defaultNoteTypeMapping, finishTransfer, NoteTypeMapping } from "./notesTransfer.js";
import { FINISHED_TRANSFER, MAPPING_KEY } from "./constants.js";
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

    const transferCompleteVal = await context.redis.get(FINISHED_TRANSFER);
    if (!transferCompleteVal) {
        return;
    }

    const usersNotes = await context.reddit.getModNotes({
        subreddit: event.subreddit.name,
        user: event.targetUser.name,
        limit: 5,
    }).all();

    // Get the first note from the last ten seconds that is of the right type.
    // We can't just get the first item, that might be a related action e.g. ban.
    const modNote = usersNotes.find(note => note.type === "NOTE" && note.createdAt > subSeconds(event.actionedAt ?? new Date(), 10));

    if (!modNote) {
        console.log(`Add Note: Didn't find a note`);
        return;
    }

    if (!modNote.userNote?.note || !modNote.user.name) {
        console.log(`Add Note: Note is not valid (got type ${modNote.type})`);
        // Not a valid mod note.
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
    await toolbox.addUsernote(event.subreddit.name, newUserNote, `"create new note on ${modNote.user.name}" via Toolbox Notes Transfer`);
    await finishTransfer(false, context);

    await context.redis.set(redisKey, new Date().getTime.toString(), { expiration: addHours(new Date(), 6) });

    console.log("Add Note: Note saved as a usernote");
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
