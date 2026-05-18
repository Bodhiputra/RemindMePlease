import Foundation
import WebKit

// Serves renderer/ files under the rmp:// scheme so popup.html keeps its
// query-string params (window.location.search) which popup.js reads for
// VIEW and TASK_ID — loadFileURL() strips query strings.
final class RMPSchemeHandler: NSObject, WKURLSchemeHandler {
    let rendererDir: URL

    init(rendererDir: URL) {
        self.rendererDir = rendererDir
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard
            let url = task.request.url,
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else {
            task.didFailWithError(makeError(404, "Bad URL"))
            return
        }

        let relativePath = components.path.hasPrefix("/")
            ? String(components.path.dropFirst())
            : components.path
        let fileURL = rendererDir.appendingPathComponent(
            relativePath.isEmpty ? "index.html" : relativePath
        )

        guard let data = try? Data(contentsOf: fileURL) else {
            task.didFailWithError(makeError(404, "File not found: \(fileURL.path)"))
            return
        }

        let mime = mimeType(for: fileURL.pathExtension)
        let response = URLResponse(
            url: url,
            mimeType: mime,
            expectedContentLength: data.count,
            textEncodingName: mime.contains("text") || mime.contains("javascript") ? "utf-8" : nil
        )
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html"
        case "js":   return "application/javascript"
        case "css":  return "text/css"
        case "png":  return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg":  return "image/svg+xml"
        case "json": return "application/json"
        default:     return "application/octet-stream"
        }
    }

    private func makeError(_ code: Int, _ msg: String) -> NSError {
        NSError(domain: "RMPScheme", code: code,
                userInfo: [NSLocalizedDescriptionKey: msg])
    }
}
