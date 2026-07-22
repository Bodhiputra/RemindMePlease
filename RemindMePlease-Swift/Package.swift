// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RemindMePlease",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "RemindMePlease",
            path: "Sources/RemindMePlease",
            linkerSettings: [
                .linkedFramework("CoreServices")
            ]
        )
    ]
)
