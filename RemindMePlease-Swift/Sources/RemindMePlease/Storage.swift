import Foundation

final class Storage {
    static let shared = Storage()

    private let dataDir: URL
    private let dataFile: URL

    private let defaultData: [String: Any] = [
        "tasks": [Any](),
        "categories": ["Work", "Personal", "Urgent", "Design", "Marketing"],
        "weeklyHistory": [Any](),
        "settings": [
            "keyboardShortcut": "CommandOrControl+Shift+Space",
            "theme": "dark",
            "defaultView": "master",
            "useIcons": false
        ] as [String: Any],
        "quickNote": ""
    ]

    private init() {
        dataDir  = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".remindmeplease")
        dataFile = dataDir.appendingPathComponent("tasks.json")
    }

    var folderPath: String { dataDir.path }

    func read() -> [String: Any] {
        ensureDir()
        guard
            FileManager.default.fileExists(atPath: dataFile.path),
            let raw  = try? Data(contentsOf: dataFile),
            let json = try? JSONSerialization.jsonObject(with: raw) as? [String: Any]
        else {
            write(defaultData)
            return defaultData
        }
        return json
    }

    @discardableResult
    func write(_ data: [String: Any]) -> Bool {
        ensureDir()
        guard let encoded = try? JSONSerialization.data(
            withJSONObject: data, options: .prettyPrinted
        ) else { return false }
        try? encoded.write(to: dataFile)
        return true
    }

    private func ensureDir() {
        try? FileManager.default.createDirectory(
            at: dataDir, withIntermediateDirectories: true)
    }
}
