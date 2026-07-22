import AppKit
import WebKit

// Central coordinator — owns both panels and all IPC logic.
// Both WebViewController and PopupViewController route messages here.
final class AppManager {
    static let shared = AppManager()

    let rendererDir = AppPaths.rendererDir

    weak var notchPanel: NotchPanel?
    weak var popupPanel: PopupPanel?
    weak var mainWebView: WKWebView?
    weak var statusItem: NSStatusItem?

    private var closedWithReopen = false
    private var rendererWatcher: RendererWatcher?

    private init() {}

    func startDevWatchingIfNeeded() {
        guard ProcessInfo.processInfo.environment["RMP_DEV"] == "1" else { return }
        rendererWatcher?.stop()
        rendererWatcher = RendererWatcher(rendererDir: rendererDir)
        rendererWatcher?.onChange = { [weak self] in
            fputs("[RMP dev] renderer changed — reloading UI\n", stderr)
            self?.reloadAllWebViews()
        }
        rendererWatcher?.start()
    }

    func reloadAllWebViews() {
        DispatchQueue.main.async {
            self.mainWebView?.reload()
        }
    }

    // ── Events → main webview ─────────────────────────────────────────────────

    func emitToMain(_ channel: String, args: String = "") {
        guard let wv = mainWebView else { return }
        let argsStr = args.isEmpty ? "" : ", \(args)"
        let js = "window.rmp._emit('\(channel)'\(argsStr))"
        DispatchQueue.main.async { wv.evaluateJavaScript(js, completionHandler: nil) }
    }

    func emitNotchGeometry(_ payload: [String: Double]) {
        guard let wv = mainWebView,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8)
        else { return }
        let js = "window.rmp._emit('notch:geometry', \(json))"
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

        case "window:get-geometry":
            if let panel = notchPanel {
                resolve(NotchGeometry.dictionary(panel.metrics))
            } else {
                let screen = NotchPanel.menuBarScreen()
                resolve(NotchGeometry.dictionary(NotchGeometry.metrics(on: screen)))
            }

        case "window:pointer-over-notch":
            resolve(notchPanel?.isPointerOverNotch() ?? false)

        case "window:refresh-hover":
            DispatchQueue.main.async { self.notchPanel?.refreshHoverState() }
            resolve(true)

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

        case "window:set-height":
            if let n = args as? NSNumber {
                notchPanel?.setHeight(CGFloat(n.doubleValue))
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

        case "export:txt":
            DispatchQueue.main.async {
                guard let text = args as? String else {
                    resolve(["success": false])
                    return
                }
                let panel = NSSavePanel()
                panel.title = "Save as Text"
                panel.nameFieldStringValue = "remindmeplease-\(Int(Date().timeIntervalSince1970)).txt"
                panel.allowedContentTypes = [.plainText]
                if panel.runModal() == .OK, let url = panel.url {
                    try? text.write(to: url, atomically: true, encoding: .utf8)
                    resolve(["success": true])
                } else {
                    resolve(["success": false])
                }
            }

        case "clipboard:write":
            if let text = args as? String {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
                resolve(true)
            } else {
                resolve(false)
            }

        case "notification:show":
            if let dict = args as? [String: Any] {
                let title = dict["title"] as? String ?? "RemindMePlease"
                let body = dict["body"] as? String ?? ""
                DispatchQueue.main.async {
                    NotificationHelper.show(title: title, body: body)
                }
            }
            resolve(true)

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
            // Disabled — global ignoresMouseEvents was the click-to-hide bug.
            break

        case "window:bring-front":
            DispatchQueue.main.async {
                self.notchPanel?.bringToFront()
            }

        case "panel:makeKey":
            DispatchQueue.main.async {
                self.notchPanel?.bringToFront()
            }

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

        case "keyboard:confetti":
            DispatchQueue.main.async {
                KeyboardHelper.postControlL()
            }

        case "window:notch-hover-suspended":
            if let on = args as? Bool {
                notchPanel?.hoverTrackingSuspended = on
                if !on { DispatchQueue.main.async { self.notchPanel?.refreshHoverState() } }
            }

        default:
            break
        }
    }

    // ── Popup lifecycle ───────────────────────────────────────────────────────

    func openPopup(view: String, taskId: String?) {
        popupPanel?.close()
        popupPanel = nil

        guard notchPanel != nil else { return }

        notchPanel?.hoverTrackingSuspended = true

        var payload: [String: Any] = ["view": view]
        if let taskId { payload["taskId"] = taskId }
        emitSheetOpen(payload)
    }

    private func emitSheetOpen(_ payload: [String: Any]) {
        guard let wv = mainWebView,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8)
        else { return }
        let js = "window.rmp._emit('sheet:open', \(json))"
        DispatchQueue.main.async { wv.evaluateJavaScript(js, completionHandler: nil) }
    }

    func popupDidClose() {
        notchPanel?.hoverTrackingSuspended = false
        notchPanel?.refreshHoverState()
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
