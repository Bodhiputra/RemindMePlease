import AppKit

final class NotchPanel: NSPanel {
    private let wvc: NotchWebViewController
    private var screenObserver: NSObjectProtocol?
    private var globalMouseMonitor: Any?
    private var localMouseMonitor: Any?
    private var mouseInsidePanel = false
    private(set) var metrics: NotchGeometry.Metrics
    private var isExpanded = false

    /// Paused while task/settings popup is open.
    var hoverTrackingSuspended = false

    /// Collapsed window height (bar + chin padding).
    var collapsedWindowHeight: CGFloat { metrics.collapsedWindowHeight }

    init() {
        wvc = NotchWebViewController()
        let screen = Self.menuBarScreen()
        metrics = NotchGeometry.metrics(on: screen)
        let frame = Self.notchFrame(on: screen, metrics: metrics, totalHeight: metrics.collapsedWindowHeight)

        super.init(
            contentRect: frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )

        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        hidesOnDeactivate = false
        isMovable = false
        isMovableByWindowBackground = false
        isFloatingPanel = true
        worksWhenModal = true
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        isReleasedWhenClosed = false

        // Boring Notch: sit just above the menu bar, not screen-saver level.
        level = NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 3)
        collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .ignoresCycle,
            .stationary,
        ]

        installWebViewLayout()

        AppManager.shared.notchPanel = self
        AppManager.shared.mainWebView = wvc.webView

        ignoresMouseEvents = false
        acceptsMouseMovedEvents = true
        becomesKeyOnlyIfNeeded = true

        refreshMetricsAndSnap(animate: false)
        orderFrontRegardless()
        observeScreenChanges()
        startMouseHoverTracking()

        DispatchQueue.main.async { [weak self] in
            self?.refreshMetricsAndSnap(animate: false)
            self?.pushGeometryToWeb()
        }
    }

    func setMousePassthrough(_ ignore: Bool) {
        ignoresMouseEvents = ignore
        if !ignore { orderFrontRegardless() }
    }

    func bringToFront() {
        NSApp.activate(ignoringOtherApps: true)
        orderFrontRegardless()
        makeKeyAndOrderFront(nil)
    }

    func pushGeometryToWeb() {
        AppManager.shared.emitNotchGeometry(NotchGeometry.dictionary(metrics))
    }

    private func installWebViewLayout() {
        let webView = wvc.webView
        webView.autoresizingMask = [.width, .height]
        webView.wantsLayer = true
        contentView = webView
        webView.frame = NSRect(origin: .zero, size: frame.size)
    }

    static func menuBarScreen() -> NSScreen {
        NSScreen.screens.max(by: { $0.frame.maxY < $1.frame.maxY })
            ?? NSScreen.main
            ?? NSScreen.screens[0]
    }

    func refreshMetricsAndSnap(animate: Bool = false) {
        metrics = NotchGeometry.metrics(on: Self.menuBarScreen())
        let h = isExpanded
            ? min(max(frame.height, metrics.collapsedWindowHeight), NotchGeometry.expandedMaxHeight)
            : metrics.collapsedWindowHeight
        applyFrame(on: Self.menuBarScreen(), totalHeight: h, animate: animate)
        pushGeometryToWeb()
    }

    func snapToMenuBar(animate: Bool = false) {
        refreshMetricsAndSnap(animate: animate)
    }

    func setHeight(_ totalHeight: CGFloat) {
        let minH = metrics.collapsedWindowHeight
        let h = min(max(totalHeight, minH), NotchGeometry.expandedMaxHeight)
        isExpanded = h > minH + 1
        applyFrame(on: Self.menuBarScreen(), totalHeight: h, animate: false)
    }

    deinit {
        stopMouseHoverTracking()
        if let o = screenObserver { NotificationCenter.default.removeObserver(o) }
    }

    // WKWebView ignores transparent pixels — track cursor in screen space instead.
    private func startMouseHoverTracking() {
        let handler: (NSEvent) -> Void = { [weak self] _ in
            self?.syncHoverFromMouseLocation()
        }
        globalMouseMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: .mouseMoved,
            handler: handler
        )
        localMouseMonitor = NSEvent.addLocalMonitorForEvents(matching: .mouseMoved) { event in
            handler(event)
            return event
        }
        syncHoverFromMouseLocation()
    }

    private func stopMouseHoverTracking() {
        if let g = globalMouseMonitor {
            NSEvent.removeMonitor(g)
            globalMouseMonitor = nil
        }
        if let l = localMouseMonitor {
            NSEvent.removeMonitor(l)
            localMouseMonitor = nil
        }
    }

    private func hoverHitRect() -> NSRect {
        // Slightly larger target when collapsed so the menu-bar notch triggers instantly.
        if isExpanded { return frame }
        return frame.insetBy(dx: -6, dy: -4)
    }

    func refreshHoverState() {
        syncHoverFromMouseLocation()
    }

    func isPointerOverNotch() -> Bool {
        hoverHitRect().contains(NSEvent.mouseLocation)
    }

    /// Called when another app takes focus — avoids stale “inside” after the pointer left while a sheet blocked leave handling.
    func noteApplicationResignedActive() {
        if mouseInsidePanel {
            mouseInsidePanel = false
            AppManager.shared.emitToMain("notch:hover-leave")
        }
        refreshHoverState()
    }

    private func syncHoverFromMouseLocation() {
        guard !hoverTrackingSuspended else { return }
        let inside = hoverHitRect().contains(NSEvent.mouseLocation)
        guard inside != mouseInsidePanel else { return }
        mouseInsidePanel = inside
        if inside {
            AppManager.shared.emitToMain("notch:hover-enter")
        } else {
            AppManager.shared.emitToMain("notch:hover-leave")
        }
    }

    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }

    private func observeScreenChanges() {
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.refreshMetricsAndSnap(animate: false)
        }
    }

    override func setFrame(_ frameRect: NSRect, display flag: Bool) {
        super.setFrame(frameRect, display: flag)
        contentView?.frame = NSRect(origin: .zero, size: frameRect.size)
    }

    private static func notchFrame(
        on screen: NSScreen,
        metrics: NotchGeometry.Metrics,
        totalHeight: CGFloat
    ) -> NSRect {
        let f = screen.frame
        let x = f.origin.x + (f.width - metrics.width) / 2
        let y = f.maxY - totalHeight
        return NSRect(x: x, y: y, width: metrics.width, height: totalHeight)
    }

    private func applyFrame(on screen: NSScreen, totalHeight: CGFloat, animate: Bool) {
        let target = Self.notchFrame(on: screen, metrics: metrics, totalHeight: totalHeight)
        setFrame(target, display: true)
        orderFrontRegardless()
        DispatchQueue.main.async { [weak self] in self?.syncHoverFromMouseLocation() }
    }

    func expand(contentHeight: CGFloat) {
        isExpanded = true
        setHeight(NotchGeometry.expandedMaxHeight)
    }

    func collapse() {
        isExpanded = false
        setHeight(metrics.collapsedWindowHeight)
    }

    func collapseInstant() {
        isExpanded = false
        setHeight(metrics.collapsedWindowHeight)
    }

    func moveBy(dx: CGFloat, dy: CGFloat) {
        guard dx != 0 else {
            snapToMenuBar(animate: false)
            return
        }
        var origin = frame.origin
        origin.x += dx
        setFrameOrigin(origin)
        snapToMenuBar(animate: false)
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if contentView?.performKeyEquivalent(with: event) == true { return true }
        return super.performKeyEquivalent(with: event)
    }

    override func sendEvent(_ event: NSEvent) {
        if event.type == .leftMouseDown {
            ignoresMouseEvents = false
            orderFrontRegardless()
            // WKWebView needs a key window for Cmd+C / Cmd+V / cut / paste in text fields.
            NSApp.activate(ignoringOtherApps: true)
            makeKeyAndOrderFront(nil)
        }
        super.sendEvent(event)
    }
}
