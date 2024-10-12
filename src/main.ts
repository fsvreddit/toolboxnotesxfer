import { Devvit, FormField } from "@devvit/public-api";
import { mapUsernoteTypesFormHandler, startTransfer, startTransferMenuHandler, transferUserBatch } from "./notesTransfer.js";
import { handleInstall } from "./installActions.js";
import { appSettings } from "./settings.js";
import { handleModAction } from "./handleModAction.js";

Devvit.addSettings(appSettings);

Devvit.addTrigger({
    event: "AppInstall",
    onEvent: handleInstall,
});

Devvit.addTrigger({
    event: "ModAction",
    onEvent: handleModAction,
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
    name: "TransferUsers",
    onRun: transferUserBatch,
});

Devvit.configure({
    redditAPI: true,
    redis: true,
});

export default Devvit;
