import AppKit
import WebKit

// Central coordinator — owns both panels and all IPC logic.
// Both WebViewController and PopupViewController route messages here.
final class AppManager {
    static let shared = AppManager()

    // Renderer files live here (dev path — bundle for production)
    let rendererDir = URL(fileURLWithPath: "/Users/fantech/remindmeplease/renderer")

    weak var notchPanel: NotchPanel?
    weak var popupPanel: PopupPanel?
    weak var mainWebView: WKWebView?
    weak var statusItem: NSStatusItem?

    private var closedWithReopen = false

    private init() {}

    // ── Events → main webview ─────────────────────────────────────────────────

    func emitToMain(_ channel: String, args: String = "") {
        guard let wv = mainWebView else { return }
        let argsStr = args.isEmpty ? "" : ", \(args)"
        let js = "window.rmp._emit('\(channel)'\(argsStr))"
        DispatchQueue.main.async { wv.evaluateJavaScript(js, completionHandler: nil) }
    }

    // ── IPC — invoke (expects a response) ────────────────────────────────────

    func handleInvoke(
        method: String,
        args: Any?,
        callId: String,
        sourceWebView: WKWebView,
        isPopup: Bool,
        resolve: @escaping (Any?) -> Void
    ) {
        switch method {

        case "storage:read":
            resolve(Storage.shared.read())

        case "storage:write":
            if let data = args as? [String: Any] {
                Storage.shared.write(data)
                // Tell the main webview to re-render
                if isPopup { emitToMain("storage:changed") }
            }
            resolve(true)

        case "window:expand":
            if let h = (args as? NSNumber)?.doubleValue {
                notchPanel?.expand(contentHeight: CGFloat(h))
            }
            resolve(true)

        case "window:collapse":
            notchPanel?.collapse()
            resolve(true)

        case "app:restart":
            resolve(true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                guard let exe = Bundle.main.executableURL else { NSApp.terminate(nil); return }
                let p = Process(); p.executableURL = exe; try? p.run()
                NSApp.terminate(nil)
            }

        case "popup:open":
            if let dict = args as? [String: Any],
               let view = dict["view"] as? String {
                let taskId = dict["taskId"] as? String
                DispatchQueue.main.async { self.openPopup(view: view, taskId: taskId) }
            }
            resolve(true)

        case "popup:close":
            closedWithReopen = false
            DispatchQueue.main.async { self.popupPanel?.close() }
            resolve(true)

        case "popup:commit":
            closedWithReopen = true
            DispatchQueue.main.async { self.popupPanel?.close() }
            resolve(true)

        case "popup:resize":
            if let h = (args as? NSNumber)?.doubleValue {
                DispatchQueue.main.async { self.popupPanel?.resize(to: CGFloat(h)) }
            }
            resolve(true)

        case "export:json":
            DispatchQueue.main.async {
                let data = Storage.shared.read()
                let panel = NSSavePanel()
                panel.title = "Export RemindMePlease Data"
                panel.nameFieldStringValue = "remindmeplease-backup-\(Int(Date().timeIntervalSince1970)).json"
                panel.allowedContentTypes = [.json]
                if panel.runModal() == .OK, let url = panel.url,
                   let encoded = try? JSONSerialization.data(withJSONObject: data, options: .prettyPrinted) {
                    try? encoded.write(to: url)
                    resolve(["success": true])
                } else {
                    resolve(["success": false])
                }
            }

        case "export:csv":
            DispatchQueue.main.async {
                let data = Storage.shared.read()
                let csv = self.buildCSV(from: data)
                let panel = NSSavePanel()
                panel.title = "Export as CSV"
                panel.nameFieldStringValue = "remindmeplease-\(Int(Date().timeIntervalSince1970)).csv"
                if panel.runModal() == .OK, let url = panel.url {
                    try? csv.write(to: url, atomically: true, encoding: .utf8)
                    resolve(["success": true])
                } else {
                    resolve(["success": false])
                }
            }

        case "data:openFolder":
            NSWorkspace.shared.open(URL(fileURLWithPath: Storage.shared.folderPath))
            resolve(true)

        default:
            resolve(nil)
        }
    }

    // ── IPC — send (fire-and-forget) ──────────────────────────────────────────

    func handleSend(method: String, args: Any?) {
        switch method {

        case "window:ignore-mouse":
            // Notch is always interactive in Swift — no-op
            break

        case "window:move":
            if let dict = args as? [String: Any],
               let dx = (dict["dx"] as? NSNumber)?.doubleValue,
               let dy = (dict["dy"] as? NSNumber)?.doubleValue {
                notchPanel?.moveBy(dx: CGFloat(dx), dy: CGFloat(dy))
            }

        case "tray:setTitle":
            if let title = args as? String {
                DispatchQueue.main.async { self.statusItem?.button?.title = title }
            }

        default:
            break
        }
    }

    // ── Popup lifecycle ───────────────────────────────────────────────────────

    func openPopup(view: String, taskId: String?) {
        popupPanel?.close()

        // Collapse the main panel instantly when popup opens
        notchPanel?.collapseInstant()
        emitToMain("panel:collapse-instant")

        guard let np = notchPanel else { return }
        let popup = PopupPanel(view: view, taskId: taskId, below: np)
        popup.appManager = self
        popupPanel = popup
        popup.makeKeyAndOrderFront(nil)
    }

    func popupDidClose() {
        if closedWithReopen {
            closedWithReopen = false
            emitToMain("panel:reopen")
        } else {
            emitToMain("popup:dismissed")
        }
        popupPanel = nil
    }

    // ── CSV builder ───────────────────────────────────────────────────────────

    private func buildCSV(from data: [String: Any]) -> String {
        var rows = ["ID,Title,Status,Priority,Category,Deadline,AddedBy,CreatedAt,CompletedAt,Notes"]
        let tasks = data["tasks"] as? [[String: Any]] ?? []
        for t in tasks {
            let id         = t["id"] as? String ?? ""
            let title      = escaped(t["title"] as? String ?? "")
            let status     = t["status"] as? String ?? ""
            let priority   = t["priority"] as? String ?? ""
            let category   = t["category"] as? String ?? ""
            let deadline   = t["deadline"] as? String ?? ""
            let addedBy    = t["addedBy"] as? String ?? "user"
            let createdAt  = t["createdAt"] as? String ?? ""
            let completedAt = t["completedAt"] as? String ?? ""
            let notes      = escaped(t["notes"] as? String ?? "")
            rows.append("\(id),\(title),\(status),\(priority),\(category),\(deadline),\(addedBy),\(createdAt),\(completedAt),\(notes)")
            for sub in (t["subtasks"] as? [[String: Any]] ?? []) {
                let subTitle = escaped("  └ \(sub["title"] as? String ?? "")")
                let subStatus = (sub["done"] as? Bool == true) ? "done" : "todo"
                rows.append("\(id)-sub,\(subTitle),\(subStatus),,,,,,, ")
            }
        }
        return rows.joined(separator: "\n")
    }

    private func escaped(_ s: String) -> String {
        "\"\(s.replacingOccurrences(of: "\"", with: "\"\""))\""
    }
}
