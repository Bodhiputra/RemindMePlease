import AppKit
import WebKit

// Shared base — used by both the notch panel and the popup panel.
class BaseWebViewController: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let webView: WKWebView
    let isPopup: Bool

    init(isPopup: Bool) {
        self.isPopup = isPopup

        let mgr = AppManager.shared
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(RMPSchemeHandler(rendererDir: mgr.rendererDir), forURLScheme: "rmp")

        // Inject window.rmp shim before any page JS runs
        let script = WKUserScript(
            source: JSPreload.source,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(script)

        // Disable WKWebView's default white background
        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs

        webView = WKWebView(frame: .zero, configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) {
            webView.underPageBackgroundColor = .clear
        }

        super.init()

        config.userContentController.add(self, name: "rmpInvoke")
        config.userContentController.add(self, name: "rmpSend")
        webView.navigationDelegate = self
    }

    var view: NSView { webView }

    // ── WKScriptMessageHandler ────────────────────────────────────────────────

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard
            let body   = message.body as? [String: Any],
            let method = body["method"] as? String
        else { return }

        let args   = body["args"]
        let callId = body["id"] as? String

        if message.name == "rmpInvoke", let callId = callId {
            AppManager.shared.handleInvoke(
                method: method,
                args: args,
                callId: callId,
                sourceWebView: webView,
                isPopup: isPopup
            ) { [weak self] result in
                self?.resolve(callId: callId, result: result)
            }
        } else if message.name == "rmpSend" {
            AppManager.shared.handleSend(method: method, args: args)
        }
    }

    // ── IPC response ──────────────────────────────────────────────────────────

    func resolve(callId: String, result: Any?) {
        let json = Self.jsLiteral(for: result)
        let js = "window.rmp._resolve('\(callId)', \(json))"
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    /// JSON-safe value for evaluateJavaScript (Bool/Int scalars are not valid JSON objects alone).
    private static func jsLiteral(for value: Any?) -> String {
        guard let value else { return "null" }
        if value is NSNull { return "null" }
        if let b = value as? Bool { return b ? "true" : "false" }
        if let n = value as? Int { return "\(n)" }
        if let n = value as? Double { return "\(n)" }
        if let n = value as? CGFloat { return "\(Double(n))" }
        if let n = value as? NSNumber { return n.stringValue }
        if let s = value as? String {
            let escaped = s
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
            return "\"\(escaped)\""
        }
        if JSONSerialization.isValidJSONObject(value),
           let data = try? JSONSerialization.data(withJSONObject: value),
           let str = String(data: data, encoding: .utf8)
        {
            return str
        }
        return "null"
    }

    func emit(_ channel: String, args: String = "") {
        let extra = args.isEmpty ? "" : ", \(args)"
        let js = "window.rmp._emit('\(channel)'\(extra))"
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }
}

// ── Main notch webview ────────────────────────────────────────────────────────

final class NotchWebViewController: BaseWebViewController {
    init() {
        super.init(isPopup: false)
        let url = URL(string: "rmp://renderer/index.html")!
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        AppManager.shared.notchPanel?.pushGeometryToWeb()
    }
}

// ── Popup webview ─────────────────────────────────────────────────────────────

final class PopupWebViewController: BaseWebViewController {
    init(view: String, taskId: String?) {
        super.init(isPopup: true)
        var components = URLComponents(string: "rmp://renderer/popup.html")!
        var items: [URLQueryItem] = [URLQueryItem(name: "view", value: view)]
        if let tid = taskId {
            items.append(URLQueryItem(name: "taskId", value: tid))
        }
        components.queryItems = items
        webView.load(URLRequest(url: components.url!))
    }
}
