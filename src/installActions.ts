import { TriggerContext } from "@devvit/public-api";
import { AppInstall, AppUpgrade } from "@devvit/protos";
import { NOTES_QUEUE } from "./constants.js";
import { importWikiPageOnInstall } from "./wikiPage.js";
import { storeInitialMappings } from "./noteMappings.js";

export async function handleInstall (_: AppInstall, context: TriggerContext) {
    await storeInitialMappings(context);
    await importWikiPageOnInstall(context);
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
