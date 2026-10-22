# Puzzle Practice

Play online at [puzzle-practice.github.io/Puzzle_Practice](https://puzzle-practice.github.io/Puzzle_Practice/).

## Running locally

On Windows, double-click `start.bat`: it updates the folder if it came from `git clone`, installs
packages and opens the game in your browser. Keep its window open while playing.

To try another branch, double-click `pick.bat` (or run `npm run pick`) and type the number of the
branch to run. Other branches run from a separate copy in a `<folder>-branches` folder, so your own
folder is never touched. `npm run pick -- --clean` deletes those copies, keeping any with edits.

Or from a terminal:

```sh
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # static site in dist/
```
