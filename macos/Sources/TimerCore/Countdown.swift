import Foundation

public enum TimerMode: String, Codable { case ready, running, paused, finished }
public enum MatchStage: String, Codable, CaseIterable {
    case regular, overtime
    public var title: String { self == .regular ? "REGULAR TIME" : "EXTRA TIME" }
}

/// A continuous, monotonic deadline. UI refresh frequency cannot change elapsed time.
public struct Countdown {
    public static let maximum: Double = 5_999
    public private(set) var duration: Double
    public private(set) var mode: TimerMode = .ready
    private var storedRemaining: Double
    private var deadline: Double = 0
    private let now: () -> Double

    public init(duration: Double = 120, now: @escaping () -> Double = MonotonicTime.now) {
        self.duration = Self.clampDuration(duration)
        self.storedRemaining = self.duration
        self.now = now
    }
    public var remaining: Double {
        mode == .running ? max(0, deadline - now()) : storedRemaining
    }
    @discardableResult public mutating func start() -> Bool {
        guard mode != .running, storedRemaining > 0 else { return false }
        deadline = now() + storedRemaining
        mode = .running
        return true
    }
    public mutating func pause() {
        guard mode == .running else { return }
        storedRemaining = remaining
        mode = storedRemaining > 0 ? .paused : .finished
    }
    @discardableResult public mutating func tick() -> Bool {
        guard mode == .running, remaining <= 0 else { return false }
        storedRemaining = 0
        mode = .finished
        return true
    }
    public mutating func reset(to seconds: Double? = nil) {
        if let seconds { duration = Self.clampDuration(seconds) }
        storedRemaining = duration
        mode = .ready
        deadline = 0
    }
    @discardableResult public mutating func adjust(by seconds: Double) -> Bool {
        guard mode != .running, seconds.isFinite else { return false }
        storedRemaining = min(Self.maximum, max(0, storedRemaining + seconds))
        duration = max(duration, storedRemaining)
        mode = storedRemaining > 0 ? .paused : .finished
        return true
    }
    /// Recovery always requires an explicit resume, including after an unexpected exit.
    public mutating func restore(remaining seconds: Double, duration: Double, mode: TimerMode) {
        self.duration = Self.clampDuration(duration)
        storedRemaining = seconds.isFinite ? min(Self.maximum, max(0, seconds)) : self.duration
        self.duration = max(self.duration, storedRemaining)
        self.mode = mode == .ready ? .ready : (storedRemaining > 0 ? .paused : .finished)
        if self.mode == .ready { storedRemaining = self.duration }
    }
    public static func format(_ seconds: Double) -> String {
        let safe = seconds.isFinite ? min(maximum, max(0, seconds)) : 0
        let total = Int(ceil(safe))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
    private static func clampDuration(_ seconds: Double) -> Double {
        seconds.isFinite ? min(maximum, max(1, seconds)) : 120
    }
}

public enum MonotonicTime {
    private static let epoch = ContinuousClock().now
    public static func now() -> Double {
        let parts = epoch.duration(to: ContinuousClock().now).components
        return Double(parts.seconds) + Double(parts.attoseconds) / 1e18
    }
}

public struct SavedMatch: Codable {
    public var stage: MatchStage
    public var regularDuration: Double
    public var overtimeDuration: Double
    public var title: String
    public var soundEnabled: Bool
    public var remaining: Double
    public var duration: Double
    public var mode: TimerMode
    public var akaScore: Int
    public var aoScore: Int
    public var akaName: String
    public var aoName: String

    public init(
        stage: MatchStage, regularDuration: Double, overtimeDuration: Double,
        title: String, soundEnabled: Bool, remaining: Double, duration: Double, mode: TimerMode,
        akaScore: Int = 0, aoScore: Int = 0, akaName: String = "AKA", aoName: String = "SHIRO"
    ) {
        self.stage = stage
        self.regularDuration = regularDuration
        self.overtimeDuration = overtimeDuration
        self.title = title
        self.soundEnabled = soundEnabled
        self.remaining = remaining
        self.duration = duration
        self.mode = mode
        self.akaScore = akaScore
        self.aoScore = aoScore
        self.akaName = akaName
        self.aoName = aoName
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        stage = try c.decode(MatchStage.self, forKey: .stage)
        regularDuration = try c.decode(Double.self, forKey: .regularDuration)
        overtimeDuration = try c.decode(Double.self, forKey: .overtimeDuration)
        title = try c.decode(String.self, forKey: .title)
        soundEnabled = try c.decode(Bool.self, forKey: .soundEnabled)
        remaining = try c.decode(Double.self, forKey: .remaining)
        duration = try c.decode(Double.self, forKey: .duration)
        mode = try c.decode(TimerMode.self, forKey: .mode)
        akaScore = try c.decodeIfPresent(Int.self, forKey: .akaScore) ?? 0
        aoScore = try c.decodeIfPresent(Int.self, forKey: .aoScore) ?? 0
        akaName = try c.decodeIfPresent(String.self, forKey: .akaName) ?? "AKA"
        aoName = try c.decodeIfPresent(String.self, forKey: .aoName) ?? "SHIRO"
    }

    public var isValid: Bool {
        [regularDuration, overtimeDuration, duration].allSatisfy { $0.isFinite && $0 >= 1 && $0 <= Countdown.maximum }
        && remaining.isFinite && remaining >= 0 && remaining <= Countdown.maximum
        && title.count <= 80
        && akaName.count <= 40 && aoName.count <= 40
        && (0...99).contains(akaScore) && (0...99).contains(aoScore)
    }
}
