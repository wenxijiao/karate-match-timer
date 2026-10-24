# Windows desktop application

An Electron application with three window roles: operator controls, a large timer and an optional AKA / SHIRO scoreboard.

## Develop and package

Use Node.js and npm. From this directory:

```sh
npm ci
npm test
npm start
npm run dist:win
```

`npm start` runs the application on the development computer's platform. `npm run dist:win` produces a portable 64-bit Windows executable in `dist/`; packaging is intended to run on Windows. Generated executables are not stored in this source repository.

## Set up an event

1. Connect the external displays and select **Extend these displays** in Windows settings.
2. Open the application and select **Timer screen** and **Score screen**.
3. Enable **Show score screen** if scoring is needed, then select **Open timer + score screens**.
4. Keep the controls on the operator's computer. On a single screen, the audience window receives the timer shortcuts; press Esc to return to controls.
5. Choose the match duration. Enable **Sound at time up** if needed and test the actual speaker output.

## Controls

| Key | Action |
| --- | --- |
| Space | Start, pause or resume |
| R | Reset time, keeping scores |
| 1-9 | Set 1-9 minutes while stopped or paused |
| Q / W / E | AKA +1 / +2 / +3 |
| I / O / P | SHIRO +1 / +2 / +3 |
| F | Open or close audience displays |
| Esc | Close audience displays |

Use the -1 buttons to correct points. **Reset scores** clears only the scores; **New bout** returns to regular time and clears both scores after confirmation. Typing in a text field does not trigger match shortcuts.

## Optional music

Music is off by default. Select **With music**, then **Choose file...** to choose an audio file on the operator's computer. No event music is included in the repository.

Playback fades in when the clock starts, fades out on pause, resumes from the same position, and returns to the beginning after reset or completion. Short tracks loop. **Clear selection** removes the saved file choice and turns music off. **Countdown only** stops music without removing the choice.

If the file is moved or deleted, choose it again. The selected path and preferences remain local.

## Recovery

The app saves match state locally and restores a previously running match as paused. Check the remaining time and scores before resuming. It requests that the computer and screens stay awake while timing or showing an audience display. Manually putting the computer to sleep or closing its lid can still interrupt an event.

See the [operator guide](../docs/operator-guide.md) for the pre-event rehearsal.
