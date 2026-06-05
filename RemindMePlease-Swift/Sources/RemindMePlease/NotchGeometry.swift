import AppKit

/// Screen-derived notch / menu bar dimensions (Boring Notch–style).
enum NotchGeometry {
    static let fallbackWidth: CGFloat = 420
    static let fallbackBarHeight: CGFloat = 32
    static let expandedMaxHeight: CGFloat = 480
    /// Slimmer bar on displays without a camera cutout (notch Macs use exact safe area).
    static let nonNotchBarTrim: CGFloat = 4
    static let minBarHeight: CGFloat = 24

    struct Metrics: Equatable {
        let width: CGFloat
        let barHeight: CGFloat
        let chinHeight: CGFloat

        var collapsedWindowHeight: CGFloat { barHeight + chinHeight }
    }

    static func metrics(on screen: NSScreen) -> Metrics {
        var width = fallbackWidth
        var barHeight = fallbackBarHeight

        if let left = screen.auxiliaryTopLeftArea?.width,
           let right = screen.auxiliaryTopRightArea?.width,
           left + right < screen.frame.width
        {
            width = screen.frame.width - left - right + 4
        }

        let menuBarHeight = max(0, screen.frame.maxY - screen.visibleFrame.maxY)

        if screen.safeAreaInsets.top > 0 {
            barHeight = screen.safeAreaInsets.top
        } else if menuBarHeight > 0 {
            barHeight = max(minBarHeight, menuBarHeight - nonNotchBarTrim)
        }

        barHeight = max(barHeight, minBarHeight)
        let chin = max(0, menuBarHeight - barHeight)

        return Metrics(width: width, barHeight: barHeight, chinHeight: chin)
    }

    static func dictionary(_ m: Metrics) -> [String: Double] {
        [
            "width": Double(m.width),
            "barHeight": Double(m.barHeight),
            "chinHeight": Double(m.chinHeight),
            "collapsedHeight": Double(m.collapsedWindowHeight),
            "expandedMax": Double(expandedMaxHeight),
        ]
    }
}
