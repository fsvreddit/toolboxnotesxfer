import { TriggerContext, UserNoteLabel } from "@devvit/public-api";
import { getToolboxUsernoteTypes } from "./interactiveTransfer.js";
import { NoteTypeMapping } from "./notesTransfer.js";
import { MAPPING_KEY } from "./constants.js";

// This mapping list covers mappings that are both historical and current. Toolbox changed their note labels at some point.
const defaultNoteTypeMapping: Record<string, UserNoteLabel> = {
    gooduser: "HELPFUL_USER",
    watch: "SPAM_WATCH",
    spamwatch: "SPAM_WATCH",
    warning: "SPAM_WARNING",
    spamwarn: "SPAM_WARNING",
    abusewarn: "ABUSE_WARNING",
    ban: "BAN",
    permban: "PERMA_BAN",
    botban: "BOT_BAN",
    // eslint-disable-next-line camelcase
    bot_ban: "BOT_BAN",
};

export async function storeInitialMappings (context: TriggerContext) {
    const toolboxNoteTypes = await getToolboxUsernoteTypes(context);
    const newMappings: NoteTypeMapping[] = toolboxNoteTypes.map(type => ({ key: type.key, value: defaultNoteTypeMapping[type.key] }));

    await context.redis.set(MAPPING_KEY, JSON.stringify(newMappings));
}
