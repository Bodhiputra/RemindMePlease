import AppKit

private let POPUP_INITIAL_HEIGHT: CGFloat = 100
private let POPUP_MIN_HEIGHT:     CGFloat = 80
private let POPUP_MAX_HEIGHT:     CGFloat = 560

final class PopupPanel: NSPanel, NSWindowDelegate {
    private let wvc: PopupWebViewController
    private let staysOpenOnResign: Bool
    weak var appManager: AppManager?

    init(view: String, taskId: String?, below notch: NotchPanel, anchorFrame: NSRect) {
        staysOpenOnResign = (view == "task-form" || view == "quick-note" || view == "settings")
        wvc = PopupWebViewController(view: view, taskId: taskId)

        let x = anchorFrame.origin.x
        let w = anchorFrame.width
        let y = anchorFrame.origin.y - POPUP_INITIAL_HEIGHT

        super.init(
            contentRect: NSRect(x: x, y: y, width: w, height: POPUP_INITIAL_HEIGHT),
            styleMask:   [.nonactivatingPanel, .borderless, .fullSizeContentView],
            backing:     .buffered,
            defer:       false
        )

        isOpaque          = false
        backgroundColor   = .clear
        hasShadow         = false
        hidesOnDeactivate = false

        level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 4)
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]

        contentView = wvc.view
        contentView?.wantsLayer = true
        delegate = self

        AppManager.shared.popupPanel = self
    }

    func resize(to height: CGFloat) {
        let h = min(max(height, POPUP_MIN_HEIGHT), POPUP_MAX_HEIGHT)
        // Anchor top edge — grow downward (lower Y in macOS coords)
        let topEdge = frame.origin.y + frame.height
        setFrame(NSRect(x: frame.origin.x,
                        y: topEdge - h,
                        width: frame.width,
                        height: h),
                 display: true, animate: false)
    }

    // ── NSWindowDelegate ──────────────────────────────────────────────────────

    func windowDidResignKey(_ notification: Notification) {
        if !staysOpenOnResign { close() }
    }

    func windowWillClose(_ notification: Notification) {
        appManager?.popupDidClose()
    }

    override var canBecomeKey:  Bool { true  }
    override var canBecomeMain: Bool { false }
}
