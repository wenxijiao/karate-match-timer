import XCTest
@testable import TimerCore

final class CountdownTests: XCTestCase {
    func testPauseResumeExcludesPausedTime() {
        var time = 0.0
        var timer = Countdown(now: { time })
        XCTAssertTrue(timer.start())
        time = 10.35
        XCTAssertEqual(timer.remaining, 109.65, accuracy: 0.0001)
        timer.pause()
        time = 900
        XCTAssertEqual(timer.remaining, 109.65, accuracy: 0.0001)
        XCTAssertTrue(timer.start())
        time = 909.65
        XCTAssertEqual(timer.remaining, 100, accuracy: 0.0001)
    }
    func testDelayedRefreshFinishesOnceWithoutDrift() {
        var time = 100.0
        var timer = Countdown(duration: 180, now: { time })
        timer.start()
        time = 350
        XCTAssertEqual(timer.remaining, 0)
        XCTAssertTrue(timer.tick())
        XCTAssertEqual(timer.mode, .finished)
        XCTAssertFalse(timer.tick())
        XCTAssertFalse(timer.start())
    }
    func testRunningAdjustmentIsRejected() {
        var time = 0.0
        var timer = Countdown(duration: 60, now: { time })
        timer.start(); time = 5
        XCTAssertFalse(timer.adjust(by: 10))
        XCTAssertEqual(timer.remaining, 55)
        timer.pause()
        XCTAssertTrue(timer.adjust(by: 10))
        XCTAssertEqual(timer.remaining, 65)
        XCTAssertEqual(timer.duration, 65)
    }
    func testResetAndBounds() {
        var timer = Countdown(duration: 2)
        timer.adjust(by: -10)
        XCTAssertEqual(timer.remaining, 0)
        XCTAssertEqual(timer.mode, .finished)
        timer.reset(to: 60)
        XCTAssertEqual(timer.mode, .ready)
        XCTAssertEqual(timer.remaining, 60)
        timer.adjust(by: 1e12)
        XCTAssertEqual(timer.remaining, 5999)
        timer.reset(to: .nan)
        XCTAssertEqual(timer.remaining, 120)
    }
    func testRecoveredRunningMatchIsPaused() {
        var timer = Countdown()
        timer.restore(remaining: 52.4, duration: 120, mode: .running)
        XCTAssertEqual(timer.mode, .paused)
        XCTAssertEqual(timer.remaining, 52.4)
        timer.restore(remaining: 0, duration: 120, mode: .finished)
        XCTAssertEqual(timer.mode, .finished)
    }
    func testDisplayUsesCeilingUntilExactZero() {
        XCTAssertEqual(Countdown.format(120), "02:00")
        XCTAssertEqual(Countdown.format(119.001), "02:00")
        XCTAssertEqual(Countdown.format(0.001), "00:01")
        XCTAssertEqual(Countdown.format(0), "00:00")
        XCTAssertEqual(Countdown.format(5999), "99:59")
    }
    func testSavedStateValidationAndRoundTrip() throws {
        var state = SavedMatch(stage: .overtime, regularDuration: 120, overtimeDuration: 60,
            title: "KARATE COMPETITION", soundEnabled: false, remaining: 45.5, duration: 60, mode: .running,
            akaScore: 3, aoScore: 1)
        let recovered = try JSONDecoder().decode(SavedMatch.self, from: JSONEncoder().encode(state))
        XCTAssertTrue(recovered.isValid)
        XCTAssertEqual(recovered.stage, .overtime)
        XCTAssertFalse(recovered.soundEnabled)
        XCTAssertEqual(recovered.akaScore, 3)
        XCTAssertEqual(recovered.aoScore, 1)
        state.remaining = -1
        XCTAssertFalse(state.isValid)
    }

    func testLegacySavedStateDefaultsScoresToZero() throws {
        let legacy = """
        {"stage":"regular","regularDuration":120,"overtimeDuration":60,"title":"KARATE",
        "soundEnabled":true,"remaining":120,"duration":120,"mode":"ready"}
        """.data(using: .utf8)!
        let recovered = try JSONDecoder().decode(SavedMatch.self, from: legacy)
        XCTAssertEqual(recovered.akaScore, 0)
        XCTAssertEqual(recovered.aoScore, 0)
        XCTAssertTrue(recovered.isValid)
    }
}
