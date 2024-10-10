import { TriggerContext, WikiPage } from "@devvit/public-api";
import { AppInstall } from "@devvit/protos";
import { defaultNoteTypeMapping, FINISHED_TRANSFER, MAPPING_KEY, WIKI_PAGE_NAME } from "./constants.js";

export async function handleInstall (_: AppInstall, context: TriggerContext) {
    await context.redis.set(MAPPING_KEY, JSON.stringify(defaultNoteTypeMapping));

    const subredditName = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;

    let wikiPage: WikiPage | undefined;
    try {
        wikiPage = await context.reddit.getWikiPage(subredditName, WIKI_PAGE_NAME);
    } catch {
        //
    }

    if (!wikiPage) {
        return;
    }

    console.log("App has previously been used! Storing previous completion date.");

    const result = JSON.parse(wikiPage.content) as { completedDate?: string };

    const finishedTransferDate = result.completedDate;
    if (finishedTransferDate) {
        await context.redis.set(FINISHED_TRANSFER, finishedTransferDate);
    }
}
