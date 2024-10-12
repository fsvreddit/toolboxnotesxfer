import { NoteTypeMapping, RedditNativeLabel } from "./notesTransfer.js";

export const NOTES_QUEUE = "NotesQueue";
export const MAPPING_KEY = "UsernoteLabelMapping";
export const FINISHED_TRANSFER = "FinishedTransfer";
export const USERS_TRANSFERRED = "UsersTransferred";
export const NOTES_TRANSFERRED = "NotesTransferred";

export const WIKI_PAGE_NAME = "toolboxnotesxfer";

export const defaultNoteTypeMapping: NoteTypeMapping[] = [
    { key: "gooduser", value: "HELPFUL_USER" },
    { key: "spamwatch", value: "SPAM_WATCH" },
    { key: "spamwarn", value: "SPAM_WARNING" },
    { key: "abusewarn", value: "ABUSE_WARNING" },
    { key: "ban", value: "BAN" },
    { key: "permban", value: "PERMA_BAN" },
    { key: "botban", value: "BOT_BAN" },
];

export const redditNativeLabels: RedditNativeLabel[] = [
    { label: "Bot Ban", value: "BOT_BAN" },
    { label: "Permaban", value: "PERMA_BAN" },
    { label: "Ban", value: "BAN" },
    { label: "Abuse Warning", value: "ABUSE_WARNING" },
    { label: "Spam Warning", value: "SPAM_WARNING" },
    { label: "Spam Watch", value: "SPAM_WATCH" },
    { label: "Solid Contributor", value: "SOLID_CONTRIBUTOR" },
    { label: "Helpful User", value: "HELPFUL_USER" },
];
