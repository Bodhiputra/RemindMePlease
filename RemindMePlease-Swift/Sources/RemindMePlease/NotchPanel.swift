import AppKit

let NOTCH_WIDTH:          CGFloat = 420
let COLLAPSED_HEIGHT:     CGFloat = 40
let EXPANDED_MAX_HEIGHT:  CGFloat = 600

final class NotchPanel: NSPanel {
    private let wvc: NotchWebViewController

    init() {
        wvc = NotchWebViewController()

        let screen = NSScreen.main ?? NSScreen.screens[0]
        let frame  = NotchPanel.defaultFrame(screen: screen)

        super.init(
            contentRect: frame,
            styleMask:   [.nonactivatingPanel, .borderless, .fullSizeContentView],
            backing:     .buffered,
            defer:       false
        )

        isOpaque         = false
        backgroundColor  = .clear
        hasShadow        = false
        hidesOnDeactivate = false
        isMovableByWindowBackground = false

        // NSWindow.Level(rawValue:) wrapping kCGStatusWindowLevel (25)
        // renders ABOVE the menu bar (level 24)
        level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.statusWindow)))

        // Visible on every Space and above full-screen apps
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]

        contentView = wvc.view
        contentView?.wantsLayer = true

        makeKeyAndOrderFront(nil)
        position(on: screen)

        AppManager.shared.notchPanel = self
        AppManager.shared.mainWebView = wvc.webView
    }

    // ── Positioning ───────────────────────────────────────────────────────────

    private static func defaultFrame(screen: NSScreen) -> NSRect {
        let sw = screen.frame.width
        let sh = screen.frame.height
        let x  = (sw - NOTCH_WIDTH) / 2
        let y  = sh - COLLAPSED_HEIGHT          // sit flush at top
        return NSRect(x: x, y: y, width: NOTCH_WIDTH, height: COLLAPSED_HEIGHT)
    }

    func position(on screen: NSScreen) {
        let sw = screen.frame.width
        let sh = screen.frame.height
        let x  = screen.frame.origin.x + (sw - NOTCH_WIDTH) / 2
        let y  = screen.frame.origin.y + sh - COLLAPSED_HEIGHT
        setFrameOrigin(NSPoint(x: x, y: y))
    }

    // ── Resize API called by AppManager ───────────────────────────────────────

    func expand(contentHeight: CGFloat) {
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let height = min(contentHeight + COLLAPSED_HEIGHT, EXPANDED_MAX_HEIGHT)
        let sw = screen.frame.width
        let sh = screen.frame.height
        let x  = screen.frame.origin.x + (sw - NOTCH_WIDTH) / 2
        let y  = screen.frame.origin.y + sh - height
        setFrame(NSRect(x: x, y: y, width: NOTCH_WIDTH, height: height),
                 display: true, animate: true)
    }

    func collapse() {
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let sh = screen.frame.height
        let sw = screen.frame.width
        let x  = screen.frame.origin.x + (sw - NOTCH_WIDTH) / 2
        let y  = screen.frame.origin.y + sh - COLLAPSED_HEIGHT
        setFrame(NSRect(x: x, y: y, width: NOTCH_WIDTH, height: COLLAPSED_HEIGHT),
                 display: true, animate: true)
    }

    func collapseInstant() {
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let sh = screen.frame.height
        let sw = screen.frame.width
        let x  = screen.frame.origin.x + (sw - NOTCH_WIDTH) / 2
        let y  = screen.frame.origin.y + sh - COLLAPSED_HEIGHT
        setFrame(NSRect(x: x, y: y, width: NOTCH_WIDTH, height: COLLAPSED_HEIGHT),
                 display: true, animate: false)
    }

    func moveBy(dx: CGFloat, dy: CGFloat) {
        var origin = frame.origin
        origin.x += dx
        origin.y -= dy  // dy from JS is screen-down positive; macOS y is upward
        setFrameOrigin(origin)
    }

    // NSPanel must override these to accept key events
    override var canBecomeKey:  Bool { true  }
    override var canBecomeMain: Bool { false }
}
