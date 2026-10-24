import AppKit
import SwiftUI
import TimerCore

extension NSScreen {
    var displayID: UInt32 {
        (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
    }
}

final class AudienceWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

private enum DisplayRole { case timer, score }

@MainActor
final class ApplicationDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var model: MatchModel!
    private var controlWindow: NSWindow!
    private var timerWindow: NSWindow?
    private var scoreWindow: NSWindow?
    private var timerScreenID: UInt32?
    private var scoreScreenID: UInt32?
    private var keyMonitor: Any?
    private var quitPromptPending = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        model = MatchModel()
        model.onOpenDisplays = { [weak self] in self?.openDisplays() }
        model.onCloseDisplays = { [weak self] in self?.closeDisplays() }
        model.onRelayoutDisplays = { [weak self] in self?.relayoutOpenDisplays() }
        model.onScoreVisibilityChanged = { [weak self] in self?.applyScoreVisibility() }
        updateScreens()
        createMenus()
        createControlWindow()
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let consumed = MainActor.assumeIsolated { self?.handleKey(event) == nil }
            return consumed ? nil : event
        }
        NotificationCenter.default.addObserver(
            self, selector: #selector(screensChanged),
            name: NSApplication.didChangeScreenParametersNotification, object: nil)
        NSApp.activate(ignoringOtherApps: true)
        controlWindow.makeKeyAndOrderFront(nil)
    }

    private func createControlWindow() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1080, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "Karate Match Timer"
        window.minSize = NSSize(width: 920, height: 640)
        window.isReleasedWhenClosed = false
        window.backgroundColor = NSColor(Palette.background)
        window.appearance = NSAppearance(named: .darkAqua)
        window.contentView = NSHostingView(rootView: ControlView(model: model))
        window.delegate = self
        window.setFrameAutosaveName("KarateTimerControlsV3")
        if !window.setFrameUsingName("KarateTimerControlsV3") { window.center() }
        controlWindow = window
    }

    private func createMenus() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "Karate Match Timer")
        add("About Karate Match Timer", action: #selector(showAbout), to: appMenu)
        appMenu.addItem(.separator())
        add("Quit Karate Match Timer", action: #selector(quit), key: "q", to: appMenu)
        appItem.submenu = appMenu
        main.addItem(appItem)

        let matchItem = NSMenuItem(title: "Match", action: nil, keyEquivalent: "")
        let matchMenu = NSMenu(title: "Match")
        add("Start / Pause", action: #selector(toggleTimer), to: matchMenu)
        add("Reset Timer", action: #selector(resetTimer), to: matchMenu)
        add("Reset Scores…", action: #selector(resetScores), to: matchMenu)
        add("New Bout…", action: #selector(newBout), to: matchMenu)
        matchMenu.addItem(.separator())
        add("Test Finish Bell", action: #selector(testBell), to: matchMenu)
        matchItem.submenu = matchMenu
        main.addItem(matchItem)

        let windowItem = NSMenuItem(title: "Window", action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: "Window")
        add("Show Controls", action: #selector(showControls), key: "1", to: windowMenu)
        add("Open Audience Displays", action: #selector(openFullscreen), key: "2", to: windowMenu)
        add("Close Audience Displays", action: #selector(closeDisplays), to: windowMenu)
        windowItem.submenu = windowMenu
        main.addItem(windowItem)

        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "Edit")
        for (name, selector, key) in [
            ("Undo", Selector(("undo:")), "z"),
            ("Cut", #selector(NSText.cut(_:)), "x"),
            ("Copy", #selector(NSText.copy(_:)), "c"),
            ("Paste", #selector(NSText.paste(_:)), "v"),
            ("Select All", #selector(NSText.selectAll(_:)), "a")
        ] {
            editMenu.addItem(NSMenuItem(title: name, action: selector, keyEquivalent: key))
        }
        editItem.submenu = editMenu
        main.addItem(editItem)

        NSApp.mainMenu = main
    }

    private func add(
        _ title: String, action: Selector, key: String = "",
        modifiers: NSEvent.ModifierFlags = [.command], to menu: NSMenu
    ) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        item.keyEquivalentModifierMask = modifiers
        menu.addItem(item)
    }

    @objc private func screensChanged() { updateScreens() }

    private func updateScreens() {
        let screens = NSScreen.screens
        var externalIndex = 0
        model.screens = screens.map { screen in
            let builtIn = CGDisplayIsBuiltin(screen.displayID) != 0
            if !builtIn { externalIndex += 1 }
            let name = builtIn ? "This Mac" : "External \(externalIndex)"
            let resolution = "\(CGDisplayPixelsWide(screen.displayID))×\(CGDisplayPixelsHigh(screen.displayID))"
            return MatchModel.ScreenChoice(
                id: screen.displayID,
                name: "\(name) · \(resolution)",
                isBuiltIn: builtIn
            )
        }

        assignDefaultScreensIfNeeded()

        // Pause if an open audience screen disappears.
        var lost = false
        if let id = timerScreenID, !screens.contains(where: { $0.displayID == id }) {
            closeWindow(.timer); lost = true
        }
        if let id = scoreScreenID, !screens.contains(where: { $0.displayID == id }) {
            closeWindow(.score); lost = true
        }
        if lost {
            let wasRunning = model.mode == .running
            if wasRunning { model.pause() }
            model.message = wasRunning
                ? "A display disconnected. Timer paused — check before resume."
                : "A display disconnected."
            showControls()
        }

        if model.anyDisplayOpen { relayoutOpenDisplays() }
    }

    private func assignDefaultScreensIfNeeded() {
        let externals = model.screens.filter { !$0.isBuiltIn }.map(\.id)
        let all = model.screens.map(\.id)
        let valid = Set(all)

        if !valid.contains(model.timerScreenID) {
            model.timerScreenID = externals.first ?? all.first ?? 0
        }
        if !valid.contains(model.scoreScreenID) {
            // Prefer a different external from the timer screen.
            model.scoreScreenID = externals.first(where: { $0 != model.timerScreenID })
                ?? all.first(where: { $0 != model.timerScreenID })
                ?? model.timerScreenID
        }

        // If both point at the same screen but two externals exist, split them.
        if model.timerScreenID == model.scoreScreenID, externals.count >= 2 {
            model.timerScreenID = externals[0]
            model.scoreScreenID = externals[1]
        }
    }

    private func screen(for id: UInt32) -> NSScreen? {
        NSScreen.screens.first(where: { $0.displayID == id })
            ?? NSScreen.main
            ?? NSScreen.screens.first
    }

    func openDisplays() {
        assignDefaultScreensIfNeeded()
        if model.showScore && model.timerScreenID == model.scoreScreenID {
            model.message = "Timer and score are on the same screen. Connect a second display, or pick different screens."
        }
        openWindow(.timer, on: model.timerScreenID)
        if model.showScore { openWindow(.score, on: model.scoreScreenID) }
        NSApp.activate(ignoringOtherApps: true)
        controlWindow.makeKeyAndOrderFront(nil)
    }

    private func applyScoreVisibility() {
        if !model.showScore {
            closeWindow(.score)
        } else if model.timerDisplayOpen && !model.scoreDisplayOpen {
            openWindow(.score, on: model.scoreScreenID)
            controlWindow.makeKeyAndOrderFront(nil)
        }
    }

    private func openWindow(_ role: DisplayRole, on screenID: UInt32) {
        guard let screen = screen(for: screenID) else {
            model.message = "No display available."
            return
        }
        closeWindow(role)

        let frame = screen.frame
        let window = AudienceWindow(
            contentRect: frame,
            styleMask: [.borderless],
            backing: .buffered, defer: false)
        window.title = role == .timer ? "Timer Display" : "Score Display"
        window.isReleasedWhenClosed = false
        window.backgroundColor = .black
        window.appearance = NSAppearance(named: .darkAqua)
        window.hasShadow = false
        window.level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 1)
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.contentView = NSHostingView(rootView: rootView(for: role))
        window.delegate = self
        window.setFrame(frame, display: false)
        window.makeKeyAndOrderFront(nil)

        switch role {
        case .timer:
            timerWindow = window
            timerScreenID = screen.displayID
            model.timerDisplayOpen = true
        case .score:
            scoreWindow = window
            scoreScreenID = screen.displayID
            model.scoreDisplayOpen = true
        }
    }

    private func rootView(for role: DisplayRole) -> AnyView {
        switch role {
        case .timer: return AnyView(TimerDisplayView(model: model, audience: true))
        case .score: return AnyView(ScoreDisplayView(model: model, audience: true))
        }
    }

    private func relayoutOpenDisplays() {
        if model.timerDisplayOpen {
            // Avoid stacking both roles on one screen after a picker change.
            if model.timerScreenID == model.scoreScreenID, model.scoreDisplayOpen {
                model.message = "Timer and score screens are the same — pick different displays."
            }
            openWindow(.timer, on: model.timerScreenID)
        }
        if model.scoreDisplayOpen {
            openWindow(.score, on: model.scoreScreenID)
        }
        controlWindow.makeKeyAndOrderFront(nil)
    }

    private func closeWindow(_ role: DisplayRole) {
        switch role {
        case .timer:
            if let window = timerWindow {
                window.delegate = nil
                window.orderOut(nil)
                window.close()
            }
            timerWindow = nil
            timerScreenID = nil
            model.timerDisplayOpen = false
        case .score:
            if let window = scoreWindow {
                window.delegate = nil
                window.orderOut(nil)
                window.close()
            }
            scoreWindow = nil
            scoreScreenID = nil
            model.scoreDisplayOpen = false
        }
    }

    @objc func closeDisplays() {
        closeWindow(.timer)
        closeWindow(.score)
        showControls()
    }

    func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow else { return }
        if window === timerWindow {
            timerWindow = nil; timerScreenID = nil; model.timerDisplayOpen = false
            showControls()
        } else if window === scoreWindow {
            scoreWindow = nil; scoreScreenID = nil; model.scoreDisplayOpen = false
            showControls()
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard sender === controlWindow else { return true }
        guard sender.attachedSheet == nil else { return false }
        if model.mode == .running && !model.anyDisplayOpen {
            model.pause()
            let alert = NSAlert()
            alert.messageText = "Close controls?"
            alert.informativeText = "Timer paused. Reopen from the Dock."
            alert.addButton(withTitle: "Keep open")
            alert.addButton(withTitle: "Hide")
            alert.buttons[0].keyEquivalent = "\u{1b}"
            alert.beginSheetModal(for: sender) { [weak sender] response in
                if response == .alertSecondButtonReturn { sender?.orderOut(nil) }
            }
            return false
        }
        sender.orderOut(nil)
        return false
    }

    private func isAudience(_ window: NSWindow?) -> Bool {
        window === timerWindow || window === scoreWindow
    }

    private func handleKey(_ event: NSEvent) -> NSEvent? {
        guard !event.isARepeat, model.pendingAction == nil,
              let window = NSApp.keyWindow,
              window === controlWindow || isAudience(window),
              event.modifierFlags.intersection([.command, .control, .option]).isEmpty
        else { return event }

        if model.isEditingText {
            if event.keyCode == 53 {
                model.isEditingTitle = false
                model.isEditingNames = false
                window.makeFirstResponder(nil)
                return nil
            }
            return event
        }

        if window.firstResponder is NSTextView || window.firstResponder is NSTextField {
            window.makeFirstResponder(nil)
        }

        switch event.keyCode {
        case 49: // Space
            model.toggle(); return nil
        case 15: // R
            model.requestReset(); showControls(); return nil
        case 3: // F
            if model.anyDisplayOpen { closeDisplays() } else { openDisplays() }
            return nil
        case 53: // Esc
            if model.anyDisplayOpen { closeDisplays(); return nil }
            return event
        default:
            break
        }

        // Digits 1–9 (top row or keypad) set the duration in minutes; never while running.
        if let digit = event.charactersIgnoringModifiers.flatMap(Int.init), (1...9).contains(digit) {
            if model.mode == .running {
                model.message = "Pause before changing duration."
            } else {
                model.setDuration(Double(digit * 60))
            }
            return nil
        }

        guard model.showScore else { return event }
        switch event.keyCode {
        // AKA: Q / W / E
        case 12: model.addScore(.aka, points: 1); return nil
        case 13: model.addScore(.aka, points: 2); return nil
        case 14: model.addScore(.aka, points: 3); return nil
        // SHIRO: I / O / P
        case 34: model.addScore(.shiro, points: 1); return nil
        case 31: model.addScore(.shiro, points: 2); return nil
        case 35: model.addScore(.shiro, points: 3); return nil
        default:
            return event
        }
    }

    @objc private func showControls() {
        NSApp.activate(ignoringOtherApps: true)
        controlWindow?.deminiaturize(nil)
        controlWindow?.makeKeyAndOrderFront(nil)
    }

    @objc private func openFullscreen() { openDisplays() }
    @objc private func toggleTimer() {
        if let window = NSApp.keyWindow,
           window.firstResponder is NSTextView || window.firstResponder is NSTextField { return }
        model.toggle()
    }
    @objc private func resetTimer() { showControls(); model.requestReset() }
    @objc private func resetScores() { showControls(); model.requestResetScores() }
    @objc private func newBout() { showControls(); model.requestNewBout() }
    @objc private func testBell() { model.testSound() }
    @objc private func quit() { NSApp.terminate(nil) }

    @objc private func showAbout() {
        let alert = NSAlert()
        alert.messageText = "Karate Match Timer"
        alert.informativeText = "Mac for control · one screen for the clock · one screen for AKA / SHIRO scores."
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showControls(); return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if quitPromptPending { return .terminateLater }
        if model.mode == .running {
            model.pause()
            showControls()
            let alert = NSAlert()
            alert.messageText = "Quit during a match?"
            alert.informativeText = "Timer paused at \(model.formattedTime)."
            alert.addButton(withTitle: "Cancel")
            alert.addButton(withTitle: "Quit")
            alert.buttons[0].keyEquivalent = "\u{1b}"
            quitPromptPending = true
            alert.beginSheetModal(for: controlWindow) { [weak self] response in
                guard let self else {
                    NSApp.reply(toApplicationShouldTerminate: false)
                    return
                }
                self.quitPromptPending = false
                NSApp.reply(toApplicationShouldTerminate: response == .alertSecondButtonReturn)
            }
            return .terminateLater
        }
        return .terminateNow
    }

    func applicationWillTerminate(_ notification: Notification) {
        model.shutdown()
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
        NotificationCenter.default.removeObserver(self)
    }
}

@main
struct KarateTimerApplication {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = ApplicationDelegate()
        app.setActivationPolicy(.regular)
        app.delegate = delegate
        app.run()
        withExtendedLifetime(delegate) {}
    }
}
