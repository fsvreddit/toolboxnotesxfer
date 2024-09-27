import {Devvit, TriggerContext, User, UserNoteLabel} from "@devvit/public-api";
import {addSeconds, format} from "date-fns";
import pluralize from "pluralize";
import {decompressBlob, ToolboxClient, Usernotes} from "toolbox-devvit";

interface NoteTypeMapping {
    key: string,
    value: UserNoteLabel
}

const noteTypeMapping: NoteTypeMapping[] = [
    {key: "gooduser", value: "HELPFUL_USER"},
    {key: "watch", value: "SPAM_WATCH"},
    {key: "warning", value: "SPAM_WARNING"},
    {key: "abusewarn", value: "ABUSE_WARNING"},
    {key: "ban", value: "BAN"},
    {key: "permban", value: "PERMA_BAN"},
    {key: "bot_ban", value: "BOT_BAN"},
];

const NOTES_QUEUE = "NotesQueue";

Devvit.addMenuItem({
    location: "subreddit",
    label: "Start Usernotes Transfer",
    onPress: async (event, context) => {
        const notesQueue = await context.redis.zRange(NOTES_QUEUE, 0, -1);
        if (notesQueue.length) {
            context.ui.showToast(`Import is already in progress! ${notesQueue.length} users still to go.`);
            await context.scheduler.runJob({
                name: "TransferUsers",
                runAt: addSeconds(new Date(), 1),
            });
            return;
        }

        const toolbox = new ToolboxClient(context.reddit);
        const subreddit = await context.reddit.getCurrentSubreddit();
        const allUserNotes = await toolbox.getUsernotes(subreddit.name);
        const distinctUsers = Object.keys(decompressBlob(allUserNotes.toJSON().blob));
        if (distinctUsers.length === 0) {
            context.ui.showToast("There is nothing to do!");
            return;
        }

        await context.redis.zAdd(NOTES_QUEUE, ...distinctUsers.map(user => ({member: user, score: 0})));
        context.ui.showToast(`Queued ${distinctUsers.length} ${pluralize("user", distinctUsers.length)} for processing.`);
        await context.scheduler.runJob({
            name: "TransferUsers",
            runAt: addSeconds(new Date(), 1),
        });
    },
});

function thingIdFromPermalink (permalink?: string): string | undefined {
    if (!permalink) {
        return;
    }

    const regex = /\/comments\/(\w{1,8})\/\w+\/(\w{1,8})?/;
    const matches = permalink.match(regex);
    if (!matches) {
        return;
    }

    const [, postId, commentId] = matches;

    if (commentId) {
        return `t1_${commentId}`;
    } else if (postId) {
        return `t3_${postId}`;
    }
}

async function transferNotesForUser (username: string, subreddit: string, usernotes: Usernotes, context: TriggerContext) {
    const usersNotes = usernotes.get(username).filter(x => x.contextPermalink);
    if (!usersNotes) {
        return;
    }

    let user: User | undefined;
    try {
        user = await context.reddit.getUserByUsername(username);
    } catch {
        //
    }

    if (!user) {
        console.log(`User ${username} is deleted, suspended or shadowbanned. Skipping.`);
        return;
    }

    let added = 0;

    for (const usernote of usersNotes.filter(x => x.contextPermalink)) {
        const label = noteTypeMapping.find(x => x.key === usernote.noteType);
        const redditId = thingIdFromPermalink(usernote.contextPermalink);

        if (label && redditId) {
            // eslint-disable-next-line no-await-in-loop
            await context.reddit.addModNote({
                label: label.value,
                note: `${usernote.text}, added by ${usernote.moderatorUsername} on ${format(usernote.timestamp, "yyyy-MM-dd")}`,
                redditId,
                subreddit,
                user: username,
            });
            added++;
        }
    }

    console.log(`Added ${added} mod ${pluralize("note", added)} for ${username}`);
}

Devvit.addSchedulerJob({
    name: "TransferUsers",
    onRun: async (event, context) => {
        const queue = await context.redis.zRange(NOTES_QUEUE, 0, 50);
        if (queue.length === 0) {
            console.log("Queue is empty!");
            return;
        }

        const toolbox = new ToolboxClient(context.reddit);
        const subreddit = await context.reddit.getCurrentSubreddit();
        const allUserNotes = await toolbox.getUsernotes(subreddit.name);

        for (const user of queue.map(queueItem => queueItem.member)) {
            // eslint-disable-next-line no-await-in-loop
            await transferNotesForUser(user, subreddit.name, allUserNotes, context);
            // eslint-disable-next-line no-await-in-loop
            await context.redis.zRem(NOTES_QUEUE, [user]);
        }

        console.log(`Processed ${queue.length} ${pluralize("user", queue.length)}. Queueing further checks`);

        if (queue.length > 0) {
            await context.scheduler.runJob({
                name: "TransferUsers",
                runAt: addSeconds(new Date(), 30),
            });
        }
    },
});

Devvit.configure({
    redditAPI: true,
    redis: true,
});

export default Devvit;
