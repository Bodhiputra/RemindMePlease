import AppKit
import Carbon.HIToolbox

enum KeyboardHelper {
    /// Posts Control+L (common confetti shortcut on macOS).
    static func postControlL() {
        let source = CGEventSource(stateID: .hidSystemState)
        let keyDown = CGEvent(
            keyboardEventSource: source,
            virtualKey: CGKeyCode(kVK_ANSI_L),
            keyDown: true
        )
        keyDown?.flags = .maskControl
        let keyUp = CGEvent(
            keyboardEventSource: source,
            virtualKey: CGKeyCode(kVK_ANSI_L),
            keyDown: false
        )
        keyUp?.flags = .maskControl
        keyDown?.post(tap: .cghidEventTap)
        keyUp?.post(tap: .cghidEventTap)
    }
}
