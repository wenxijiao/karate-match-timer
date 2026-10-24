import AppKit
import AVFoundation
import Combine
import TimerCore

enum Competitor: String {
    case aka, shiro
}

@MainActor
final class MatchModel: ObservableObject {
    @Published private(set) var remaining: Double = 120
    @Published private(set) var total: Double = 120
    @Published private(set) var mode: TimerMode = .ready
    @Published private(set) var stage: MatchStage = .regular
    @Published private(set) var regularDuration: Double = 120
    @Published private(set) var overtimeDuration: Double = 60
    @Published private(set) var akaScore = 0
    @Published private(set) var aoScore = 0
    @Published var akaName = "AKA" {
        didSet {
            if akaName.count > 40 { akaName = String(akaName.prefix(40)) }
            save()
        }
    }
    @Published var aoName = "SHIRO" {
        didSet {
            if aoName.count > 40 { aoName = String(aoName.prefix(40)) }
            save()
        }
    }
    @Published var eventTitle = "KARATE" { didSet { save() } }
    /// When true, Space/R go to text fields instead of the timer.
    @Published var isEditingTitle = false
    @Published var isEditingNames = false
    @Published var soundEnabled = true { didSet { save() } }

    var displayAkaName: String {
        let trimmed = akaName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "AKA" : trimmed
    }
    var displayAoName: String {
        let trimmed = aoName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "SHIRO" : trimmed
    }
    var isEditingText: Bool { isEditingTitle || isEditingNames }
    @Published var message: String?
    @Published var timerDisplayOpen = false { didSet { updateActivity() } }
    @Published var scoreDisplayOpen = false { didSet { updateActivity() } }
    @Published var showScore = UserDefaults.standard.object(forKey: "showScoreScreen") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(showScore, forKey: "showScoreScreen")
            onScoreVisibilityChanged?()
        }
    }
    @Published private(set) var isKeepingAwake = false
    @Published var screens: [ScreenChoice] = []
    @Published var timerScreenID: UInt32 = 0
    @Published var scoreScreenID: UInt32 = 0
    @Published var pendingAction: PendingAction?

    private var countdown = Countdown()
    private var refreshTimer: Timer?
    private var lastCheckpoint = 0.0
    private var activity: NSObjectProtocol?
    private var player: AVAudioPlayer?
    private var restoring = true
    var onOpenDisplays: (() -> Void)?
    var onCloseDisplays: (() -> Void)?
    var onRelayoutDisplays: (() -> Void)?
    var onScoreVisibilityChanged: (() -> Void)?

    struct PendingAction: Identifiable {
        let id = UUID()
        let title: String
        let detail: String
        let button: String
        let perform: () -> Void
    }
    struct ScreenChoice: Identifiable {
        let id: UInt32
        let name: String
        let isBuiltIn: Bool
    }

    var anyDisplayOpen: Bool { timerDisplayOpen || scoreDisplayOpen }
    var configuredDuration: Double { stage == .regular ? regularDuration : overtimeDuration }
    var formattedTime: String { Countdown.format(remaining) }
    var isWarning: Bool { mode == .running && remaining > 0 && remaining <= 10 }
    var progress: Double { min(1, max(0, remaining / max(1, total))) }
    var statusTitle: String {
        switch mode {
        case .ready: return "READY"
        case .running: return "RUNNING"
        case .paused: return "PAUSED"
        case .finished: return "TIME UP"
        }
    }
    var displayMessage: String {
        switch mode {
        case .ready: return stage == .overtime ? "EXTRA TIME READY" : "READY"
        case .running: return isWarning ? "FINAL 10 SECONDS" : ""
        case .paused: return "PAUSED"
        case .finished: return "TIME UP"
        }
    }
    var buttonTitle: String {
        switch mode {
        case .ready: return "Start"
        case .running: return "Pause"
        case .paused: return "Resume"
        case .finished: return "Finished"
        }
    }

    init() {
        restore()
        restoring = false
        if let url = Bundle.main.url(forResource: "finish-bell", withExtension: "wav") {
            do { player = try AVAudioPlayer(contentsOf: url); player?.prepareToPlay() }
            catch { message = "Finish bell could not load. Test sound before the match." }
        }
        refreshTimer = Timer(timeInterval: 0.04, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refresh() }
        }
        RunLoop.main.add(refreshTimer!, forMode: .common)
    }

    // MARK: - Timer

    func toggle() {
        guard pendingAction == nil else { return }
        if mode == .running { pause(); return }
        guard countdown.start() else { return }
        message = nil
        publish(); updateActivity(); save()
    }

    func pause() {
        let wasRunning = countdown.mode == .running
        countdown.pause()
        publish(); updateActivity(); save()
        if wasRunning && mode == .finished { playBell() }
    }

    func requestReset() {
        if mode == .running { pause() }
        applyReset()
    }

    private func applyReset() {
        countdown.reset(to: configuredDuration)
        message = nil
        publish(); updateActivity(); save()
    }

    func setDuration(_ seconds: Double) {
        guard mode != .running else {
            message = "Pause before changing duration."
            return
        }
        guard seconds.isFinite && seconds >= 1 && seconds <= Countdown.maximum else {
            message = "Duration must be between 00:01 and 99:59."
            return
        }
        if stage == .regular { regularDuration = seconds } else { overtimeDuration = seconds }
        countdown.reset(to: seconds)
        message = nil
        publish(); updateActivity(); save()
    }

    func prepareExtraTime() {
        guard mode != .running else {
            message = "Pause before starting extra time."
            return
        }
        let go = { [weak self] in
            guard let self else { return }
            self.stage = .overtime
            self.countdown.reset(to: self.overtimeDuration)
            self.message = "Extra time loaded — press Start when ready."
            self.publish(); self.updateActivity(); self.save()
        }
        if mode == .finished || mode == .ready {
            go()
        } else {
            ask(title: "Load extra time?",
                detail: "Clear the current clock and set \(Countdown.format(overtimeDuration)) for extra time.",
                button: "Load extra time", action: go)
        }
    }

    func returnToRegular() {
        guard mode != .running else {
            message = "Pause before returning to regular time."
            return
        }
        let go = { [weak self] in
            guard let self else { return }
            self.stage = .regular
            self.countdown.reset(to: self.regularDuration)
            self.message = nil
            self.publish(); self.updateActivity(); self.save()
        }
        if mode == .finished || mode == .ready {
            go()
        } else {
            ask(title: "Back to regular time?",
                detail: "Clear the current clock and set \(Countdown.format(regularDuration)).",
                button: "Regular time", action: go)
        }
    }

    func adjust(_ seconds: Double) {
        guard countdown.adjust(by: seconds) else { return }
        message = nil
        publish(); save()
    }

    // MARK: - Score (WKF-style points: 1 / 2 / 3)

    func addScore(_ competitor: Competitor, points: Int) {
        guard [1, 2, 3].contains(points) else { return }
        switch competitor {
        case .aka: akaScore = min(99, akaScore + points)
        case .shiro: aoScore = min(99, aoScore + points)
        }
        save()
    }

    func subtractScore(_ competitor: Competitor, points: Int = 1) {
        switch competitor {
        case .aka: akaScore = max(0, akaScore - points)
        case .shiro: aoScore = max(0, aoScore - points)
        }
        save()
    }

    func requestResetScores() {
        if akaScore == 0 && aoScore == 0 { return }
        ask(
            title: "Reset scores?",
            detail: "AKA and SHIRO will both return to 0. The timer is not changed.",
            button: "Reset scores"
        ) { [weak self] in
            self?.akaScore = 0
            self?.aoScore = 0
            self?.save()
        }
    }

    func requestNewBout() {
        if mode == .running { pause() }
        ask(
            title: "New bout?",
            detail: "Reset the timer to \(Countdown.format(configuredDuration)) and clear both scores.",
            button: "New bout"
        ) { [weak self] in
            guard let self else { return }
            if self.stage == .overtime {
                self.stage = .regular
            }
            self.countdown.reset(to: self.regularDuration)
            self.akaScore = 0
            self.aoScore = 0
            self.message = nil
            self.publish(); self.updateActivity(); self.save()
        }
    }

    // MARK: - Displays

    func openDisplays() { onOpenDisplays?() }
    func closeDisplays() { onCloseDisplays?() }

    func confirmPending() {
        let action = pendingAction?.perform
        pendingAction = nil
        action?()
    }

    func cancelPending() { pendingAction = nil }

    func testSound() {
        playBell(force: true)
        message = "Test bell played — check speaker volume."
    }

    private func ask(title: String, detail: String, button: String, action: @escaping () -> Void) {
        pendingAction = PendingAction(title: title, detail: detail, button: button, perform: action)
    }

    private func playBell(force: Bool = false) {
        guard soundEnabled || force else { return }
        guard let player else { NSSound.beep(); return }
        player.stop(); player.currentTime = 0
        if !player.play() { message = "Sound could not play. Check audio output." }
    }

    private func refresh() {
        if countdown.tick() {
            publish(); updateActivity(); save(); playBell()
        } else if mode == .running {
            remaining = countdown.remaining
            let now = MonotonicTime.now()
            if now - lastCheckpoint >= 1 { save(); lastCheckpoint = now }
        }
    }

    private func publish() {
        remaining = countdown.remaining
        total = countdown.duration
        mode = countdown.mode
    }

    private func updateActivity() {
        let needed = mode == .running || anyDisplayOpen
        if needed && activity == nil {
            activity = ProcessInfo.processInfo.beginActivity(
                options: [.userInitiated, .idleSystemSleepDisabled, .idleDisplaySleepDisabled],
                reason: "Keep the competition timer and audience displays active")
        } else if !needed, let activity {
            ProcessInfo.processInfo.endActivity(activity)
            self.activity = nil
        }
        isKeepingAwake = activity != nil
    }

    func save() {
        guard !restoring else { return }
        let state = SavedMatch(
            stage: stage, regularDuration: regularDuration, overtimeDuration: overtimeDuration,
            title: String(eventTitle.prefix(80)), soundEnabled: soundEnabled,
            remaining: countdown.remaining, duration: countdown.duration, mode: countdown.mode,
            akaScore: akaScore, aoScore: aoScore,
            akaName: String(akaName.prefix(40)), aoName: String(aoName.prefix(40)))
        if let data = try? JSONEncoder().encode(state) {
            UserDefaults.standard.set(data, forKey: "savedMatchV1")
        }
    }

    private func restore() {
        guard let data = UserDefaults.standard.data(forKey: "savedMatchV1"),
              let saved = try? JSONDecoder().decode(SavedMatch.self, from: data),
              saved.isValid else { return }
        stage = saved.stage
        regularDuration = saved.regularDuration
        overtimeDuration = saved.overtimeDuration
        eventTitle = saved.title
        soundEnabled = saved.soundEnabled
        akaScore = saved.akaScore
        aoScore = saved.aoScore
        akaName = saved.akaName
        // Migrate previous default label AO → SHIRO.
        aoName = saved.aoName == "AO" ? "SHIRO" : saved.aoName
        countdown.restore(remaining: saved.remaining, duration: saved.duration, mode: saved.mode)
        remaining = countdown.remaining
        total = countdown.duration
        mode = countdown.mode
        if saved.mode != .ready {
            message = "Previous time recovered. Check before resuming."
        }
    }

    func shutdown() {
        save()
        refreshTimer?.invalidate()
        refreshTimer = nil
        if let activity {
            ProcessInfo.processInfo.endActivity(activity)
            self.activity = nil
        }
        player?.stop()
    }
}
