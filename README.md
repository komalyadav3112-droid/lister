# Lister

Your personal tasks, calendar, focus timer, tracker, habits and notes, running on your laptop.

## Open Lister

1. Double-click **Start Lister.bat** in this folder.
2. A small black window opens, and Lister opens in your browser at http://127.0.0.1:5317
3. Keep the black window open while you use Lister. Close it when you're done.

## Install it as an app (one time, in Microsoft Edge)

1. With Lister open in Edge, click the **App available** icon at the right end of the address bar.
   (Or: **⋯** menu → **Apps** → **Install this site as an app**.)
2. Click **Install**. Lister now opens in its own window from the Start menu.
3. Right-click its taskbar icon → **Pin to taskbar**.

After installing, Lister opens from the Start menu even without the black window.
Run **Start Lister.bat** again whenever you get an updated version of the app files, so the new version loads.

## Pages

- **Tasks**: type a task and press Enter. Dates and times are picked up automatically:
  - `Study maths tomorrow 2pm to 5pm` adds a 2–5 PM block on the calendar for tomorrow
  - `Call mom friday at 6pm`, `Gym between 6 and 7`, `Dentist 28 oct at 4pm`
  - Click a task to add steps, a reminder, a repeat (daily, weekdays, weekly, monthly), a priority or a list.
- **Calendar**: week and month views. Click an empty slot to add a task at that time.
- **Focus**: a flip-clock focus timer with an optional ticking sound. Pick the task you're working on.
- **Tracker**: completion rate, tasks done per day, focus minutes per day, where your focus went.
- **Habits**: tick off each day, with streaks and optional daily reminders.
- **Notes**: quick notes that save as you type.
- **Settings**: theme, notifications, timer lengths, backups.

## Desktop timer

**Start Lister.bat** also starts a small timer in the bottom-right corner of your screen.

- It shows up when a focus session or break is running and Lister is minimized or closed. It hides while Lister is on screen.
- **Pause / Resume** controls the same timer as the Focus page. When a session ends it chimes and offers **Start break** or **Start focus**.
- Sessions that finish on the desktop timer are added to the Tracker the next time you open Lister.
- Drag it anywhere. Right-click it to open Lister or to quit the desktop timer.
- It keeps running after you close Lister. It needs **Start Lister.bat** to have been started this time you turned on your laptop.

## Reminders

Go to **Settings → Turn on notifications**. Reminders pop up as Windows notifications while
Lister is open (it can be minimized).

## Your data

Everything is saved in the browser on this laptop. Use **Settings → Save a backup file** now and
then. The backup file is also how your data moves to the two-person version later.

## Files

- `app/`: the app itself (`index.html`, `styles.css`, `app.js`, `sw.js` for offline use)
- `server.ps1`: the small local server that **Start Lister.bat** runs
