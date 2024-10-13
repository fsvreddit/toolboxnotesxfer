import { TriggerContext, WikiPage } from "@devvit/public-api";
import { AppInstall, AppUpgrade } from "@devvit/protos";
import { FINISHED_TRANSFER, MAPPING_KEY, NOTES_QUEUE, WIKI_PAGE_NAME } from "./constants.js";
import { defaultNoteTypeMapping } from "./notesTransfer.js";

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

    console.log("Install: App has previously been used! Storing previous completion date.");

    const result = JSON.parse(wikiPage.content) as { completedDate?: number };

    const finishedTransferDate = result.completedDate;
    if (finishedTransferDate) {
        await context.redis.set(FINISHED_TRANSFER, finishedTransferDate.toString());
    }
}

export async function handleInstallOrUpgrade (_: AppInstall | AppUpgrade, context: TriggerContext) {
    const jobs = await context.scheduler.listJobs();
    await Promise.all(jobs.map(job => context.scheduler.cancelJob(job.id)));

    await context.scheduler.runJob({
        name: "updateWikiPage",
        cron: "0 0 * * *",
    });

    const queuedNotes = await context.redis.zCard(NOTES_QUEUE);
    if (queuedNotes) {
        await context.scheduler.runJob({
            name: "TransferUsers",
            runAt: new Date(),
        });
    }

    console.log("Install: App has been upgraded. Jobs rescheduled.");
}
