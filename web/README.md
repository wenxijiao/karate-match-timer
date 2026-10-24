# Browser timer

This is the earlier **timer-only** version. It has separate operator and audience windows, regular and extra time, pause/resume, keyboard shortcuts, local recovery and a synthesised bell. Scoring is available in the desktop applications.

Download the repository, keep `index.html`, `styles.css` and `app.js` together, and open `index.html` in a browser. No installation, build process, network resources or server is required.

Select **Open audience display**, allow the popup, move it to the external monitor and select **Full screen** there. Keep the control window open.

| Key | Action |
| --- | --- |
| Space | Start, pause or resume from the controls |
| R | Reset the timer from the controls |
| F | Enter or leave full screen |

After reloading the controls, the saved timer is restored paused. Close the old audience window and reopen it from the controls. An audience window that loses its control connection shows a warning after approximately six seconds; the warning does not automatically pause the match.

Browser support for full screen, wake locks and local file storage varies. Test the chosen browser and external display before the event. See the [operator guide](../docs/operator-guide.md).
