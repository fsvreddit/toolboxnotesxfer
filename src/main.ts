import { Devvit, FormField } from "@devvit/public-api";
import { mapUsernoteTypesFormHandler, startTransferMenuHandler, transferUserBatch } from "./notesTransfer.js";
import { handleInstall } from "./installActions.js";

Devvit.addTrigger({
    event: "AppInstall",
    onEvent: handleInstall,
});

export const mapUsernoteTypesForm = Devvit.createForm(data => ({ fields: data.fields as FormField[], title: data.title as string }), mapUsernoteTypesFormHandler);

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
