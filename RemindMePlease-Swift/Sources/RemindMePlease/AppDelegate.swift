import AppKit
import Carbon.HIToolbox

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var notchPanel: NotchPanel!
    private var statusItem: NSStatusItem!
    private var hotKeyRef: EventHotKeyRef?

    func applicationDidFinishLaunching(_ notification: Notification) {
        quitLegacyElectron()
        NotificationHelper.requestAuthorizationIfNeeded()
        setupStatusBar()
        setupNotchPanel()
        registerGlobalHotKey()
        ReminderScheduler.shared.start()
    }

    /// Only one app should run — kill the old Electron build if it is still open.
    private func quitLegacyElectron() {
        let pkill = URL(fileURLWithPath: "/usr/bin/pkill")
        for pattern in ["electron.*remindmeplease", "Electron /Users/fantech/remindmeplease"] {
            let proc = Process()
            proc.executableURL = pkill
            proc.arguments = ["-f", pattern]
            try? proc.run()
            proc.waitUntilExit()
        }
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        notchPanel?.snapToMenuBar(animate: false)
        notchPanel?.refreshHoverState()
    }

    func applicationDidResignActive(_ notification: Notification) {
        notchPanel?.noteApplicationResignedActive()
        AppManager.shared.emitToMain("app:resign-active")
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let ref = hotKeyRef { UnregisterEventHotKey(ref) }
    }

    // ── Status bar (tray) ─────────────────────────────────────────────────────

    private func setupStatusBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = ""
        statusItem.button?.font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular)

        let menu = NSMenu()
        menu.addItem(NSMenuItem(
            title: "Restart",
            action: #selector(restartApp),
            keyEquivalent: ""
        ))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(
            title: "Quit RemindMePlease",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        ))
        statusItem.menu = menu

        AppManager.shared.statusItem = statusItem
    }

    // ── Notch panel ───────────────────────────────────────────────────────────

    private func setupNotchPanel() {
        notchPanel = NotchPanel()
        DispatchQueue.main.async {
            AppManager.shared.startDevWatchingIfNeeded()
        }
    }

    // ── Global hot key: Cmd+Shift+Space ──────────────────────────────────────

    private func registerGlobalHotKey() {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind:  UInt32(kEventHotKeyPressed)
        )
        let hkID = EventHotKeyID(signature: fourCharCode("RMPK"), id: 1)

        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(
            GetApplicationEventTarget(),
            { (_, event, userData) -> OSStatus in
                guard let ptr = userData else { return noErr }
                let delegate = Unmanaged<AppDelegate>.fromOpaque(ptr).takeUnretainedValue()
                DispatchQueue.main.async { delegate.handleHotKey() }
                return noErr
            },
            1,
            &eventType,
            selfPtr,
            nil
        )

        RegisterEventHotKey(
            UInt32(kVK_Space),             // Space
            UInt32(cmdKey | shiftKey),     // Cmd+Shift
            hkID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
    }

    @objc private func handleHotKey() {
        AppManager.shared.popupPanel?.close()
        notchPanel?.collapseInstant()
        AppManager.shared.emitToMain("panel:collapse-instant")
    }

    @objc private func restartApp() {
        guard let exe = Bundle.main.executableURL else { NSApp.terminate(nil); return }
        let p = Process(); p.executableURL = exe; try? p.run()
        NSApp.terminate(nil)
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

private func fourCharCode(_ s: String) -> OSType {
    s.utf8.prefix(4).reduce(OSType(0)) { $0 << 8 | OSType($1) }
}
