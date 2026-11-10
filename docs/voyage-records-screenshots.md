# Screenshots to save for the Shipwide Records page

Every linked record now has its screenshot saved in `public/voyage-records/screenshots/` (in `cursed-isles/` or `vampire-lairs/`), so the page no longer depends on imgur or gyazo. A new screenshot shows up on the page as soon as its file is there and the record's `screenshot` path in `src/voyage-records/sheet-records.json` points to it.

## Records with no screenshot on the sheet

These have no proof link at all, so they show a dash. If you have a picture for any of them, send it over too.

- Cursed Isles: best score for every crew size (1 to 7) and the one-pirate best entry score (526, Jice)
- Cursed Isles: most frays in one entry for every crew size
- Cursed Isles: best duty report score for 7 pirates (216) and 1 pirate (36)
- Cursed Isles: most points in one forage for forages 2, 3, 4, 10 to 17
- Vampire Lairs: most frays in one entry (11) and most vampire proof (22)
- Vampire Lairs: Placivieri's 8 immortal chests (the sheet links to "Theresnopictureofthis")
- Vampire Lairs: every crew size except 4, 5, 6, 7 and 12 (those come from the stats tab, which has no links)
- Woodhallow: all of them (they come from chatlogs)

Three Cursed Isles records are YouTube videos (Placivieri's 43-point duty report and forage 9); the page links to the video.

## Adding records that come with pictures

Players are asked to send a picture, image or video with each record. Their message numbers the records (1., 2., ...), in the same order as the data at the bottom of it. To add the records and their pictures in one go, make a folder for the send-in:

```
gummy-2026-11-09/
  message.txt     the copied message, or their "Download all my records" .json (only one .txt or .json; a README.txt or notes.txt is ignored)
  1.png           picture for record 1
  1-b.png         a second picture for record 1 (anything after the number is fine)
  2.mp4           a video for record 2
  crew.png        no number at the start: goes with every record in the file
```

Then drag the folder onto `add-voyage-records.bat` (or run `npm run add-records -- path/to/folder`). It adds the records as before, and also:

- copies each picture into `public/voyage-records/screenshots/<voyage>/sent/`, named for the ocean, crew size and the file's contents;
- lists them for their record in the `screenshots` part of `src/voyage-records/sheet-records.json`, so they show up on Global records (videos play in the same viewer);
- takes a beaten record's old pictures off it, since they show the old record;
- adds pictures to a record that's already on the table with none, when the file ties it, so pictures that arrive late can still go up;
- puts everything in the same pull request, and prints any picture it didn't use and why.

Pictures can be .png, .jpg, .gif or .webp, and videos .mp4, .webm, .mov or .m4v. GitHub won't take a file over 100 MB, so a bigger video is left out: put it on YouTube and add the link as `videoUrl` instead. Use `--dry-run` first to see which picture goes with which record.
