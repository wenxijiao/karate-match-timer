// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "KarateTimer",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "KarateTimer", targets: ["KarateTimer"])],
    targets: [
        .target(name: "TimerCore"),
        .executableTarget(name: "KarateTimer", dependencies: ["TimerCore"]),
        .testTarget(name: "TimerCoreTests", dependencies: ["TimerCore"])
    ]
)
