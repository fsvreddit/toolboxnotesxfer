import { ModAction } from "@devvit/protos";
import { TriggerContext } from "@devvit/public-api";
import { handleWikiRevise } from "./handleWikiReviseAction.js";
import { handleAddNote } from "./handleAddNoteAction.js";
import { hasTriggerBeenHandled } from "@fsvreddit/fsv-devvit-helpers";
import { addMinutes } from "date-fns";

async function hasModActionBeenHandled (event: ModAction, context: TriggerContext): Promise<boolean> {
    return await hasTriggerBeenHandled(context.redis, `modAction:${event.action}:${event.moderator?.name}:${event.actionedAt?.getTime()}`, { expiration: addMinutes(new Date(), 10) });
}

export async function handleModActions (event: ModAction, context: TriggerContext) {
    if (event.action === "wikirevise") {
        if (await hasModActionBeenHandled(event, context)) {
            console.log("Wiki Revise: Trigger already handled, skipping.");
            return;
        }
        await handleWikiRevise(event, context);
        return;
    }

    if (event.action === "addnote") {
        if (await hasModActionBeenHandled(event, context)) {
            console.log("Add Note: Trigger already handled, skipping.");
            return;
        }
        await handleAddNote(event, context);
        return;
    }
}
