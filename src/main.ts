import { Devvit, FormField } from "@devvit/public-api";
import { mapUsernoteTypesFormHandler, startTransfer, startTransferMenuHandler, transferUserBatch } from "./interactiveTransfer.js";
import { handleInstall, handleInstallOrUpgrade } from "./installActions.js";
import { appSettings } from "./settings.js";
import { handleModActions } from "./handleModActions.js";
import { updateWikiPage } from "./notesTransfer.js";
import { TRANSFER_USERS_JOB } from "./constants.js";

Devvit.addSettings(appSettings);

Devvit.addTrigger({
    event: "AppInstall",
    onEvent: handleInstall,
});

Devvit.addTrigger({
    events: ["AppInstall", "AppUpgrade"],
    onEvent: handleInstallOrUpgrade,
});

Devvit.addTrigger({
    event: "ModAction",
    onEvent: handleModActions,
});

export const mapUsernoteTypesForm = Devvit.createForm(data => ({ fields: data.fields as FormField[], title: data.title as string }), mapUsernoteTypesFormHandler);

export const confirmForm = Devvit.createForm(data => ({ fields: [], title: "Ready to transfer", description: data.description as string }), startTransfer);

Devvit.addMenuItem({
    location: "subreddit",
    label: "Start Usernotes Transfer",
    forUserType: "moderator",
    onPress: startTransferMenuHandler,
});

Devvit.addSchedulerJob({
    name: TRANSFER_USERS_JOB,
    onRun: transferUserBatch,
});

Devvit.addSchedulerJob({
    name: "updateWikiPage",
    onRun: updateWikiPage,
});

Devvit.configure({
    redditAPI: true,
    redis: true,
});

export default Devvit;
