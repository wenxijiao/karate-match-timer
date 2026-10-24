# Karate Match Timer

Competition helper for karate kumite:

- **This Mac** — operator controls
- **External screen 1** — large countdown
- **External screen 2** — AKA / SHIRO scoreboard

## Run

Build from source using the commands below, then open **dist/Karate Match Timer.app** (macOS 13+). This repository contains the source; generated application bundles are excluded from Git.

## Match-day setup

1. Connect two external monitors in **extended** mode (not mirroring).
2. Open the app. It assigns the first external to the timer and the second to the score when possible.
3. Confirm **Timer screen** and **Score screen**, then click **Open timer + score screens**.
4. Keep the control window on the Mac. Use Space / score keys from there.

## During a bout

| Key | Action |
| --- | --- |
| Space | Start / pause / resume |
| R | Reset timer (scores kept) |
| 1–9 | Set duration to 1–9 minutes (only when paused or stopped) |
| Q / W / E | AKA +1 / +2 / +3 |
| I / O / P | SHIRO +1 / +2 / +3 |
| F | Open or close both audience displays |
| Esc | Close audience displays |

WKF-style points on the buttons: **+1 Yuko · +2 Waza-ari · +3 Ippon**. Use **−1** to correct a mistake.

- **Reset scores** — clear AKA/SHIRO only
- **New bout** — reset timer to regular duration and clear scores
- Extra time stays as a small optional link after a bout

## Build

Requires Xcode or Apple Command Line Tools with Swift 5.9 or later, plus Python 3 for the generated bell sound.

```sh
swift test
bash scripts/build-app.sh
open "dist/Karate Match Timer.app"
```

The build script compiles Apple Silicon and Intel versions into a universal application, generates its icon and finish bell, and applies an ad-hoc signature. It is not an Apple-notarised distribution build.

See the [operator guide](../docs/operator-guide.md) for the event setup and recovery procedure.
