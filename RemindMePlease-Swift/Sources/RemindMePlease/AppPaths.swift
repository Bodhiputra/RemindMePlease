import Foundation

enum AppPaths {
    /// UI bundle: `Contents/Resources/renderer` in production, repo `renderer/` in dev.
    static let rendererDir: URL = resolveRendererDir()

    private static func resolveRendererDir() -> URL {
        let fm = FileManager.default
        let isDev = ProcessInfo.processInfo.environment["RMP_DEV"] == "1"

        if isDev {
            if let dir = envRendererDir(), fm.fileExists(atPath: dir.appendingPathComponent("index.html").path) {
                return dir
            }
            if let dir = repoRendererDir(), fm.fileExists(atPath: dir.appendingPathComponent("index.html").path) {
                return dir
            }
        }

        let bundled = Bundle.main.bundleURL
            .appendingPathComponent("Contents/Resources/renderer", isDirectory: true)
        if fm.fileExists(atPath: bundled.appendingPathComponent("index.html").path) {
            return bundled
        }

        if let dir = repoRendererDir(), fm.fileExists(atPath: dir.appendingPathComponent("index.html").path) {
            return dir
        }

        if let dir = envRendererDir() {
            return dir
        }

        fatalError("RemindMePlease: renderer not found. Rebuild with ./restart.sh or run ./dev.sh")
    }

  /// remindmeplease/renderer next to RemindMePlease-Swift/
    private static func repoRendererDir() -> URL? {
        Bundle.main.bundleURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("renderer", isDirectory: true)
    }

    private static func envRendererDir() -> URL? {
        guard let env = ProcessInfo.processInfo.environment["RMP_RENDERER_DIR"], !env.isEmpty else {
            return nil
        }
        return URL(fileURLWithPath: env, isDirectory: true)
    }
}
