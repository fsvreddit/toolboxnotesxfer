import { TriggerContext } from "@devvit/public-api";
import { ModAction } from "@devvit/protos";
import { AppSetting } from "./settings.js";
import { FINISHED_TRANSFER, MAPPING_KEY, WIKI_PAGE_REVISION } from "./constants.js";
import { finishTransfer, getAllNotes, NoteTypeMapping, transferNotesForUser, usersWithNotesSince } from "./notesTransfer.js";

export async function handleModAction (event: ModAction, context: TriggerContext) {
    if (event.action !== "wikirevise" || !event.subreddit) {
        return;
    }

    const settings = await context.settings.getAll();
    if (!settings[AppSetting.AutomaticIncrementalTransfer]) {
        return;
    }

    const transferCompleteVal = await context.redis.get(FINISHED_TRANSFER);
    if (!transferCompleteVal) {
        return;
    }

    const transferCompleteDate = new Date(parseInt(transferCompleteVal));

    const wikiPage = await context.reddit.getWikiPage(event.subreddit.name, "usernotes");
    const lastRevisionProcessed = await context.redis.get(WIKI_PAGE_REVISION);

    if (wikiPage.revisionId === lastRevisionProcessed) {
        // Page updated wasn't Toolbox wiki page
        return;
    }

    console.log("Toolbox wiki page updated with changes.");

    const allUserNotes = await getAllNotes(context);
    const usersToProcess = usersWithNotesSince(allUserNotes, transferCompleteDate);

    if (usersToProcess.length === 0) {
        console.log("No new notes.");
        return;
    }

    console.log(`New notes for ${usersToProcess.length} exist.`);

    const noteTypeMappingValue = await context.redis.get(MAPPING_KEY);

    let noteTypeMapping: NoteTypeMapping[] = [];
    if (noteTypeMappingValue) {
        noteTypeMapping = JSON.parse(noteTypeMappingValue) as NoteTypeMapping[];
    }

    for (const user of usersToProcess) {
        await transferNotesForUser(user, event.subreddit.name, allUserNotes, noteTypeMapping, transferCompleteDate, context);
    }

    await context.redis.set(WIKI_PAGE_REVISION, wikiPage.revisionId);
    await finishTransfer(false, context);
}