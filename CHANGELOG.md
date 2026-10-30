# Changelog

## Beta stage (Android 0.2.0-beta.1 to beta.13, web 0.7.0-beta)

The beta adds songs played from YouTube, a single field for adding music from links, sharing into the app, Anki exchange of the dictionary, real song lengths, a sturdier dictionary and a lyrics lookup that keeps going in the background. The beta installs as its own app (`io.github.dontcarecat.chorus.beta`, shown as "Chorus") next to the alpha. The web app is the source of truth: every change was made there first.

### Beta 1: songs from YouTube
- Add a song from a YouTube link. It is played by YouTube's own embedded player (official player only, nothing downloaded, nothing cached, no background playback, the player's controls stay visible).
- Title and artist are guessed from the video title and channel and can be edited; thumbnail and a YouTube badge in the library; a settings switch with the terms and privacy text.
- The game plays a YouTube song with its own clock (buffering and ads are a hold, stepped fades), and the song page has the player and "Sync start" to line the lyrics up.
- The video's length comes from the player and is kept; lyrics matching works while the length is still unknown. Facts about a video are checked again after 30 days; a video that is gone shows as unavailable.
- New game layouts for phones, tablets and desktop (one or two columns, keyboard modes, dialogs clear of the player).
- Share from the YouTube app to Chorus opens Add music with the link filled in.

### Beta 2
- Fixed: the page drew under the Android status bar on newer WebViews.

### Beta 3
- Removals and "Restore backup" ask in the app's own dialog (a sheet on phones) instead of the browser's confirm.

### Beta 4
- Import a public YouTube playlist (the first 200 videos, in batches), optionally as a Chorus playlist.

### Beta 5
- Song-list import: paste a list ("Artist - Title" per line) or load a CSV; songs you already have are matched into a Chorus playlist, the rest get a "Find on YouTube" link. (Spotify no longer lets other apps read a playlist through its API, so the API route was dropped.)
- The deletion dialog follows the design guide.

### Beta 6
- One link field in Add music: a YouTube video, a YouTube or YouTube Music playlist, a Spotify song, or words to search for. No API key is needed: searching opens YouTube ("Find on YouTube") and you paste the video's link back.
- Share to Chorus: YouTube and Spotify links, and audio files from a file manager. Files are added where they are and never copied.

### Beta 7
- Lyrics candidates show their length and how far it is from the song's, closest first; a setting picks the closest one automatically.
- The paste icon really pastes from the clipboard; clear (x) buttons in the link and playlist name fields; an imported playlist suggests the original playlist's name.
- Spotify playlists are put aside for now (Spotify song links still work).
- The import panels stay inside the screen.

### Beta 8: Anki
- Dictionary > Export and Import. Export as an Anki deck (`.apkg`, Anki's older format) or as plain text; review progress can travel with the deck. Import an `.apkg` or a text/CSV list. Re-importing updates instead of duplicating.
- The song's length is shown in the lyrics dialog header and is read from the video's page, without playing it.
- "Import a song list" is a short underlined link; the explanation shows after tapping it.

### Beta 9
- Every song has its real length: YouTube songs get it when added (or later, quietly, for songs already in the library), local files are measured from the file. The "length not known" text is gone.
- A word already in your translation language, or one the translation service returns unchanged, still gets a meaning (Wiktionary's English definition, or a translation into English).
- The Anki import picker accepts any file (Android has no file type for `.apkg`).

### Beta 10
- The Add music help no longer claims Spotify playlists work.

### Beta 11: dictionary lifecycle and background lookup
- The dictionary parser no longer turns "clipping of" or "synonym of" lines into false inflections (this made "Zeit" come out as "Uhrzeit" with the meaning ")"). Meanings are cleaned of stray brackets and "(see usage notes)". Wiktionary errors such as rate limiting are no longer taken for "no such page".
- "Look up again" asks Wiktionary again (it used to reuse the cached answer) and is available on every entry. Failed lookups are retried on their own, at most once an hour, and a busy database no longer marks an entry as failed.
- The lyrics lookup keeps going while the app is out of sight, with a progress notification ("120 of 935" and a bar), and it goes on during a game in the quiet moments between its actions.

### Beta 12: one card per base word and type
- A dictionary card is one base word and type: "macht" and "leiht" join "machen" and "leihen", "Macht" (noun) is its own card. Merged cards keep the most advanced review progress. Asking a form you already have finds its card.
- A capitalised first word of a line weighs both Wiktionary pages (a verb form first, then numerals and pronouns, then a noun).
- A one-time repair runs on the first start (and after restoring an older backup): duplicates merged, bad meanings cleared, suspicious entries looked up again in the background.
- Anki: re-importing a Chorus deck recognises the cards; a word's Anki note id no longer changes when its card is re-keyed.

### Beta 13
- The app is called "Chorus" (the beta no longer says "Beta" in its name).
- German nouns whose gender Wiktionary writes in the inline form (`<m,,en.weak_n>`, as for "Herr") get their article.

### Also in the web app (0.7.0-beta)
- A lookup status bar for lyrics lookups, a selection bar with an actions menu, retry of lyrics lookups for songs that have none, and long libraries drawn row by row (a few thousand songs stay fast).
- Fixed: answers given while a game waits were scored as "ahead"; the score gain is placed under the score pill on phones.
- Fixed: a word without a translation says why when it is already in your translation language; HTML entities in translations are decoded.
- Review sessions ask Again/Hard cards again; a "System" theme option; no tap highlight or text selection on controls.

### Known limits
- Spotify playlists are not supported (Spotify closed the API). Song links work, and a list of songs can be pasted or loaded from CSV. Reading a Spotify song uses Spotify's public embed page, which is unofficial and can stop working.
- The lyrics lookup runs in the app's page, so it can still slow a game slightly and stops when the phone freezes the app. A native background worker is planned.
- The web database's text column for words is not accent-sensitive on MySQL, so two words differing only in an accent could be merged into one card there.
- Some Wiktionary pages have no gender or an unusual layout; those words show without an article.
