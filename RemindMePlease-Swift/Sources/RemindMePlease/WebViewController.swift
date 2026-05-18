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
        let json: String
        if let r = result {
            json = (try? String(
                data: JSONSerialization.data(withJSONObject: r, options: []),
                encoding: .utf8
            )) ?? "null"
        } else {
            json = "null"
        }
        let js = "window.rmp._resolve('\(callId)', \(json))"
        DispatchQueue.main.async { [weak self] in
            self?.webView.evaluateJavaScript(js, completionHandler: nil)
        }
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
