import { TriggerContext } from "@devvit/public-api";
import { ModAction } from "@devvit/protos";
import { AppSetting } from "./settings.js";
import { FINISHED_TRANSFER, LAST_SYNC_COMPLETED, MAPPING_KEY, UPDATE_WIKI_PAGE_FLAG, WIKI_PAGE_REVISION } from "./constants.js";
import { finishTransfer, getAllNotes, NoteTypeMapping, recordSyncStarted, transferNotesForUser, usersWithNotesInScope } from "./notesTransfer.js";
import pluralize from "pluralize";

export async function handleWikiRevise (event: ModAction, context: TriggerContext) {
    if (event.action !== "wikirevise" || !event.subreddit) {
        return;
    }

    const settings = await context.settings.getAll();
    if (!settings[AppSetting.AutomaticForwardTransfer]) {
        return;
    }

    const transferCompleteVal = await context.redis.get(FINISHED_TRANSFER);
    const lastSyncCompleteVal = await context.redis.get(LAST_SYNC_COMPLETED);

    if (!transferCompleteVal && !lastSyncCompleteVal) {
        return;
    }

    if (event.moderator?.name === context.appName) {
        await finishTransfer(false, context);
        return;
    }

    let fromDate = transferCompleteVal ? new Date(parseInt(transferCompleteVal)) : undefined;

    if (lastSyncCompleteVal) {
        const lastSyncCompleted = new Date(parseInt(lastSyncCompleteVal));
        if (!fromDate || lastSyncCompleted > fromDate) {
            fromDate = lastSyncCompleted;
        }
    }

    const wikiPage = await context.reddit.getWikiPage(event.subreddit.name, "usernotes");
    const lastRevisionProcessed = await context.redis.get(WIKI_PAGE_REVISION);

    if (wikiPage.revisionId === lastRevisionProcessed) {
        // Page updated wasn't Toolbox wiki page
        return;
    }

    console.log("Wiki Revise: Toolbox wiki page updated with changes.");

    const allUserNotes = await getAllNotes(context);
    const usersToProcess = usersWithNotesInScope(allUserNotes, fromDate);

    if (usersToProcess.length === 0) {
        console.log("Wiki Revise: No new notes.");
        await context.redis.set(WIKI_PAGE_REVISION, wikiPage.revisionId);
        await finishTransfer(false, context);
        return;
    }

    console.log(`Wiki Revise: Found new notes for ${usersToProcess.length} ${pluralize("user", usersToProcess.length)}.`);

    const noteTypeMappingValue = await context.redis.get(MAPPING_KEY);

    let noteTypeMapping: NoteTypeMapping[] = [];
    if (noteTypeMappingValue) {
        noteTypeMapping = JSON.parse(noteTypeMappingValue) as NoteTypeMapping[];
    }

    for (const user of usersToProcess) {
        await transferNotesForUser(user, event.subreddit.name, allUserNotes, noteTypeMapping, fromDate, undefined, context);
    }

    await context.redis.set(WIKI_PAGE_REVISION, wikiPage.revisionId);
    await context.redis.set(UPDATE_WIKI_PAGE_FLAG, "true");
    await recordSyncStarted(context);

    await finishTransfer(false, context);
    await context.redis.set(LAST_SYNC_COMPLETED, new Date().getTime().toString());
}
