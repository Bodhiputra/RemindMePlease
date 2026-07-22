import Foundation
import CoreServices

/// Watches renderer/ in dev mode and reloads WKWebView when UI files change.
final class RendererWatcher {
    var onChange: (() -> Void)?

    private let watchPath: String
    private var stream: FSEventStreamRef?
    private var debounceWorkItem: DispatchWorkItem?

    private static let uiExtensions: Set<String> = [
        "html", "js", "css", "json", "svg", "png", "jpg", "jpeg"
    ]

    init(rendererDir: URL) {
        watchPath = rendererDir.path
    }

    func start() {
        guard ProcessInfo.processInfo.environment["RMP_DEV"] == "1" else { return }

        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )

        let paths = [watchPath as CFString] as CFArray
        stream = FSEventStreamCreate(
            nil,
            { _, info, numEvents, eventPaths, _, _ in
                guard let info else { return }
                let watcher = Unmanaged<RendererWatcher>.fromOpaque(info).takeUnretainedValue()
                let paths = unsafeBitCast(eventPaths, to: CFArray.self) as? [String] ?? []
                for path in paths {
                    if watcher.shouldReload(path: path) {
                        watcher.scheduleReload()
                        break
                    }
                }
            },
            &context,
            paths,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.2,
            UInt32(kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagFileEvents)
        )

        guard let stream else { return }
        FSEventStreamScheduleWithRunLoop(stream, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
        FSEventStreamStart(stream)
        fputs("[RMP dev] watching renderer at \(watchPath)\n", stderr)
    }

    func stop() {
        debounceWorkItem?.cancel()
        if let stream {
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
        }
        stream = nil
    }

    private func shouldReload(path: String) -> Bool {
        let ext = (path as NSString).pathExtension.lowercased()
        guard !ext.isEmpty else { return false }
        return Self.uiExtensions.contains(ext)
    }

    private func scheduleReload() {
        debounceWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.onChange?() }
        debounceWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }
}
