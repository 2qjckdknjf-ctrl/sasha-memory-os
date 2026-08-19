// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MemoryOSAppleCompanion",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "AppleCompanionDomain",
            targets: ["AppleCompanionDomain"]
        ),
        .library(
            name: "AppleCompanionAppScaffold",
            targets: ["AppleCompanionAppScaffold"]
        )
    ],
    targets: [
        .target(
            name: "AppleCompanionDomain",
            path: "Sources/AppleCompanionDomain"
        ),
        .target(
            name: "AppleCompanionAppScaffold",
            dependencies: ["AppleCompanionDomain"],
            path: "Sources/AppleCompanionAppScaffold"
        )
    ]
)
