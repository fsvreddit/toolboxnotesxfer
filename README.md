A Devvit app to transfer and synchronise Toolbox usernotes to native Reddit mod notes

This app supports bulk transfer of notes from Toolbox to Reddit mod notes as well as live synchronisation between usernotes and mod notes. If sync is off then further incremental transfers can be done after the initial bulk.

If you already use Toolbox usernotes and intend to do a bulk transfer, I strongly recommend starting the bulk transfer BEFORE you turn on synchronisation settings. This will result in the most reliable mapping of Toolbox note types to native mod note categories, especially if you have customised Toolbox's note types.

## Bulk Transfer

This app can transfer Toolbox usernotes to Reddit mod notes in bulk. To start a transfer, click the subreddit context menu and choose "Start Usernotes Transfer".

You may be prompted to map your Toolbox usernote categories to native Reddit ones, depending on how your sub has configured Toolbox. If you do not choose a mapping for a usernote category, notes with that category will be transferred without a note type set.

Notes will then transfer in the background. Depending on the number of usernotes on your subreddit, it can take a substantial amount of time, ranging from minutes to hours on subreddits that have used notes heavily for years.

Once all notes have transferred, this app will create a "Mod Discussions" conversation in Modmail informing you that it's done.

If you press the "Start Transfer" button again while a transfer is in progress, it won't start again. You will instead be told how many users still need notes transferring.

If you try and start a new transfer after a transfer has completed, the app will check for usernotes made since the previous transfer and only transfer those.

## Additional incremental transfers

Once an initial bulk transfer has completed, you can use the same process to transfer any additional notes added since the first transfer completed.

## Live synchronisation of new Toolbox usernotes with Reddit mod notes

You can choose to synchronise newly added Toolbox notes to Reddit mod notes (and in reverse) as they are added. This must be enabled in app settings.

Synchronisation may be done even if a bulk transfer has not been done, but I recommend doing a bulk transfer early on if you intend to do one anyway. This ensures that mappings between Toolbox note types and Reddit note types are more reliable.

Only new additions are processed. Deletions are not currently handled.

## Limitations

This app can only record mod notes as if they were added at the time of transfer, and by /u/toolboxnotesxfer. This means that the dates/times of notes will always be wrong unless the note was transferred via the sync process.

As a result, all Toolbox usernotes transferred using this method will have text appended e.g. "original note text, added by actualmod on 2024-03-15". If the usernote was added on the same day that the transfer occurs, the date will be omitted.

![Example of mod note with text appended](https://raw.githubusercontent.com/fsvreddit/toolboxnotesxfer/main/doc_images/ModNote.png)

If a note is linked to content other than a post or comment (e.g. a note created from modmail), that link will be removed (Reddit's mod notes can only link to posts or comments).

Usernotes can only be transferred for active users. Suspended, shadowbanned and deleted users will be skipped.

## Source Code

This app is open source, you can find it on GitHub [here](https://github.com/fsvreddit/toolboxnotesxfer).

## Change History

### v1.1.1

* Use more reliable method of pacing note transfers.

### v1.0.3

* Transfer older notes first, so that they appear in the right order
* Send post-transfer modmail to inbox, not Mod Discussions

### v1.0.1

* Fixed a bug that caused a generic error message when Toolbox isn't fully configured, or there are no usernotes
