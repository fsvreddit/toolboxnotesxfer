import { RawUsernoteType } from "toolbox-devvit/dist/types/RawSubredditConfig.js";

export const NOTES_QUEUE = "NotesQueue";
export const MAPPING_KEY = "UsernoteLabelMapping";
export const FINISHED_TRANSFER = "FinishedTransfer";
export const BULK_FINISHED = "BulkFinished";
export const SYNC_STARTED = "SyncStarted";
export const LAST_SYNC_COMPLETED = "LastSyncCompleted";

export const USERS_TRANSFERRED = "UsersTransferred";
export const NOTES_TRANSFERRED = "NotesTransferred";
export const NOTES_ERRORED = "NotesErrored";
export const USERS_SKIPPED = "UsersSkipped";

export const WIKI_PAGE_NAME = "toolboxnotesxfer";
export const WIKI_PAGE_REVISION = "wikiPageRevision";
export const UPDATE_WIKI_PAGE_FLAG = "wikiPageUpdate";

// Taken from toolbox-devvit's config.ts file as this is not exported.
export const DEFAULT_USERNOTE_TYPES: RawUsernoteType[] = [
    { key: "gooduser", color: "green", text: "Good Contributor" },
    { key: "spamwatch", color: "fuchsia", text: "Spam Watch" },
    { key: "spamwarn", color: "purple", text: "Spam Warning" },
    { key: "abusewarn", color: "orange", text: "Abuse Warning" },
    { key: "ban", color: "red", text: "Ban" },
    { key: "permban", color: "darkred", text: "Permanent Ban" },
    { key: "botban", color: "black", text: "Bot Ban" },
];
