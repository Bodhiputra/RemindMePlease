import Foundation

enum AppPaths {
    /// UI bundle: `Contents/Resources/renderer` in the .app, or repo `renderer/` in dev.
    static let rendererDir: URL = resolveRendererDir()

    private static func resolveRendererDir() -> URL {
        let fm = FileManager.default
        let bundled = Bundle.main.bundleURL
            .appendingPathComponent("Contents/Resources/renderer", isDirectory: true)
        if fm.fileExists(atPath: bundled.appendingPathComponent("index.html").path) {
            return bundled
        }

        // Dev fallback when running RemindMePlease-Swift/RemindMePlease.app from the repo.
        let dev = bundled
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("renderer", isDirectory: true)
        if fm.fileExists(atPath: dev.appendingPathComponent("index.html").path) {
            return dev
        }

        if let env = ProcessInfo.processInfo.environment["RMP_RENDERER_DIR"],
           !env.isEmpty
        {
            return URL(fileURLWithPath: env, isDirectory: true)
        }

        fatalError("RemindMePlease: renderer not found. Rebuild with ./restart.sh")
    }
}
