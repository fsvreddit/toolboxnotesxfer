import { ModAction } from "@devvit/protos";
import { TriggerContext } from "@devvit/public-api";
import { handleWikiRevise } from "./handleWikIRevise.js";
import { handleAddNote } from "./handleAddNote.js";

export async function handleModActions (event: ModAction, context: TriggerContext) {
    if (event.action === "wikirevise") {
        await handleWikiRevise(event, context);
        return;
    }

    if (event.action === "addnote") {
        await handleAddNote(event, context);
        return;
    }
}
