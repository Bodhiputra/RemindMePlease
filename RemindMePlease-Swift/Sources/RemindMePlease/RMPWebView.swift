import AppKit
import WebKit

/// Borderless NSPanel + WKWebView does not route standard edit shortcuts to web text fields.
/// Forward Cmd+key actions through the responder chain (copy, paste, undo, etc.).
final class RMPWebView: WKWebView {
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if forwardEditShortcut(event) { return true }
        return super.performKeyEquivalent(with: event)
    }

  private func forwardEditShortcut(_ event: NSEvent) -> Bool {
        guard event.type == .keyDown, event.modifierFlags.contains(.command) else { return false }

        let key = event.charactersIgnoringModifiers ?? ""
        let selector: Selector? = {
            switch key {
            case "a": return #selector(NSResponder.selectAll(_:))
            case "c": return Selector("copy:")
            case "x": return Selector("cut:")
            case "v": return Selector("paste:")
            case "z":
                return event.modifierFlags.contains(.shift)
                    ? Selector("redo:")
                    : Selector("undo:")
            default: return nil
            }
        }()

        guard let selector else { return false }
        return NSApp.sendAction(selector, to: nil, from: self)
    }
}
