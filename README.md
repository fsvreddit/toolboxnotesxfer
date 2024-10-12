A Devvit app to transfer Toolbox usernotes to native Reddit mod notes

## Bulk Transfer

This app can transfer Toolbox usernotes to Reddit mod notes in bulk. To start a transfer, click the subreddit context menu and choose "Start Usernotes Transfer".

You may be prompted to map your Toolbox usernote categories to native Reddit ones, depending on how your sub has configured Toolbox.

Notes will then transfer in the background. Depending on the number of usernotes on your subreddit, it can take a substantial amount of time, ranging from minutes to hours on subreddits that have used notes heavily for years.

Once all notes have transferred, this app will create a "Mod Discussions" conversation in Modmail informing you that it's done.

If you press the "Start Transfer" button again while a transfer is in progress, it won't start again. You will instead be told how many users still need notes transferring.

If you try and start a new transfer after a transfer has completed, the app will check for usernotes made since the previous transfer and only transfer those.

## Additional incremental transfers

Once an initial bulk transfer has completed, you can use the same process to transfer any additional notes added since the first transfer completed.

## Live synchronisation from Toolbox usernotes to Reddit mod notes

Once an initial bulk transfer has completed, you can choose to synchronise newly added Toolbox notes to Reddit mod notes as they are added. This must be enabled in app settings.

## Limitations

This app can only record notes as if they were added at the time of transfer, and by /u/toolboxnotesxfer. This means that the dates/times of notes will always be wrong.

As a result, all usernotes transferred using this method will have text appended e.g. "original note text, added by actualmod on 2024-03-15". If the usernote was added on the same day that the transfer occurs, the date will be omitted.

![Example of mod note with text appended](https://raw.githubusercontent.com/fsvreddit/toolboxnotesxfer/main/doc_images/ModNote.png)

If a note is linked to content other than a post or comment (e.g. a note created from modmail), that link will be removed (Reddit's mod notes can only link to posts or comments).

Usernotes can only be transferred for active users. Suspended, shadowbanned and deleted users will be skipped.

## Source Code and acknowledgements

This app is open source, you can find it on GitHub [here](https://github.com/fsvreddit/toolboxnotesxfer).

I'd like to thank the Toolbox Team for making [this NPM package](https://www.npmjs.com/package/toolbox-devvit) available, which made developing this app much easier.
