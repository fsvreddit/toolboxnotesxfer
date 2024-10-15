import { TriggerContext, WikiPage, WikiPagePermissionLevel } from "@devvit/public-api";
import { FINISHED_TRANSFER, LAST_SYNC_COMPLETED, SYNC_STARTED, UPDATE_WIKI_PAGE_FLAG, WIKI_PAGE_NAME } from "./constants.js";

interface StoredWikiPage {
    completedDate?: number;
    syncStarted?: number;
    lastSyncCompleted?: number;
}

export async function importWikiPageOnInstall (context: TriggerContext) {
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

    console.log("Install: App has previously been used! Storing previous completion date.");

    const result = JSON.parse(wikiPage.content) as StoredWikiPage;

    if (result.completedDate) {
        await context.redis.set(FINISHED_TRANSFER, result.completedDate.toString());
    }

    if (result.syncStarted) {
        await context.redis.set(SYNC_STARTED, result.syncStarted.toString());
    }

    if (result.lastSyncCompleted) {
        await context.redis.set(LAST_SYNC_COMPLETED, result.lastSyncCompleted.toString());
    }
}

function parseIntIfDefined (input?: string): number | undefined {
    return input ? parseInt(input) : undefined;
}

export async function saveWikiPage (context: TriggerContext) {
    const [completedDate, syncStarted, lastSyncCompleted] = await Promise.all([
        context.redis.get(FINISHED_TRANSFER),
        context.redis.get(SYNC_STARTED),
        context.redis.get(LAST_SYNC_COMPLETED),
    ]);

    const wikiData: StoredWikiPage = {
        completedDate: parseIntIfDefined(completedDate),
        syncStarted: parseIntIfDefined(syncStarted),
        lastSyncCompleted: parseIntIfDefined(lastSyncCompleted),
    };

    const subredditName = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;

    // Store completed date in the wiki, to allow for future incremental updates.
    // It's important not to use Redis here to preserve data if app is uninstalled.
    let wikiPage: WikiPage | undefined;
    try {
        wikiPage = await context.reddit.getWikiPage(subredditName, WIKI_PAGE_NAME);
    } catch {
        //
    }

    const wikiSaveOptions = {
        subredditName,
        page: WIKI_PAGE_NAME,
        content: JSON.stringify(wikiData),
        reason: "Storing completion date for transfer",
    };

    if (wikiPage) {
        await context.reddit.updateWikiPage(wikiSaveOptions);
    } else {
        await context.reddit.createWikiPage(wikiSaveOptions);
        await context.reddit.updateWikiPageSettings({
            subredditName,
            page: WIKI_PAGE_NAME,
            listed: false,
            permLevel: WikiPagePermissionLevel.MODS_ONLY,
        });
    }

    await context.redis.del(UPDATE_WIKI_PAGE_FLAG);
}
