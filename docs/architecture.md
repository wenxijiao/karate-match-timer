# Engineering notes

## Time follows a deadline

The countdown uses a monotonic clock and a deadline rather than subtracting one unit on each UI refresh. A delayed redraw therefore does not lengthen a round. Pausing stores the remaining duration; resuming creates a new deadline. Completion is emitted once.

The Swift implementation uses `ContinuousClock`; JavaScript uses a monotonic time source. The browser display estimates time between updates from the operator. System sleep behaviour varies by platform, so the event state should be checked after a machine sleeps.

## Separate controls and displays

The macOS application uses SwiftUI views hosted in AppKit windows. A shared match model supplies the operator, timer and score windows. The timer core is a separate Swift package target with deterministic clock tests.

The Windows application keeps the match model in Electron's main process. Renderer windows receive snapshots through a preload bridge; operator actions return through IPC. Display placement follows the selected system monitor. Tests use a fake Electron environment to exercise main-process behaviour without requiring physical monitors.

The browser version uses `BroadcastChannel` and `postMessage` with a per-session identifier to link the operator and audience windows. It is an earlier implementation focused on timing, without the desktop scoring controls.

## Local recovery

Control actions save the match state, and a running clock checkpoints approximately once per second. Reopening restores a previously running timer as paused so the operator can confirm the time. macOS uses application preferences; Windows writes local JSON files; the browser uses local storage.

## Assets and packaging

The macOS build scripts generate the icon and a three-strike bell locally. The Windows application includes its icon and finish bell, while optional music is selected from the operator's own files. The browser synthesises its bell with Web Audio.

The macOS build script creates a universal Apple Silicon / Intel application with an ad-hoc signature. Windows packaging creates a portable executable. Build output belongs in each platform's `dist/` directory and is excluded from Git.

## Validation boundaries

Automated tests cover countdown state, delayed refreshes, pause/resume, recovery and bounds. JavaScript tests also cover score changes, display orchestration and optional music. These checks do not replace physical monitor placement and speaker-volume tests at the venue. The repository records one confirmed community event, on 10 October 2026; future use was requested by the instructor.
