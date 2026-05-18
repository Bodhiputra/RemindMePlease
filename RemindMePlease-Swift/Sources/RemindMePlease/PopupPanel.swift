import AppKit

private let POPUP_INITIAL_HEIGHT: CGFloat = 100
private let POPUP_MIN_HEIGHT:     CGFloat = 80
private let POPUP_MAX_HEIGHT:     CGFloat = 560

final class PopupPanel: NSPanel, NSWindowDelegate {
    private let wvc: PopupWebViewController
    private let isTaskForm: Bool
    weak var appManager: AppManager?

    init(view: String, taskId: String?, below notch: NSPanel) {
        isTaskForm = (view == "task-form")
        wvc = PopupWebViewController(view: view, taskId: taskId)

        // Position directly below the notch panel
        let x = notch.frame.origin.x
        let y = notch.frame.origin.y - POPUP_INITIAL_HEIGHT

        super.init(
            contentRect: NSRect(x: x, y: y, width: NOTCH_WIDTH, height: POPUP_INITIAL_HEIGHT),
            styleMask:   [.nonactivatingPanel, .borderless, .fullSizeContentView],
            backing:     .buffered,
            defer:       false
        )

        isOpaque          = false
        backgroundColor   = .clear
        hasShadow         = false
        hidesOnDeactivate = false

        // Same level as the notch — stack above menu bar
        level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.statusWindow)))
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
                        width: NOTCH_WIDTH,
                        height: h),
                 display: true, animate: false)
    }

    // ── NSWindowDelegate ──────────────────────────────────────────────────────

    func windowDidResignKey(_ notification: Notification) {
        // Close when focus leaves, unless this is the task-form (user may be
        // interacting with native pickers or other UI outside the popup).
        if !isTaskForm {
            close()
        }
    }

    func windowWillClose(_ notification: Notification) {
        appManager?.popupDidClose()
    }

    override var canBecomeKey:  Bool { true  }
    override var canBecomeMain: Bool { false }
}
