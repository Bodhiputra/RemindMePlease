import Foundation

/// Polls task storage and fires macOS notifications for due reminders.
final class ReminderScheduler {
    static let shared = ReminderScheduler()

    private var timer: Timer?

    private init() {}

    func start() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.checkReminders()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            self?.checkReminders()
        }
    }

    func checkReminders() {
        var data = Storage.shared.read()
        guard var tasks = data["tasks"] as? [[String: Any]] else { return }

        let now = Date()
        var changed = false

        for index in tasks.indices {
            var task = tasks[index]
            guard let status = task["status"] as? String,
                  status != "done", status != "archived" else { continue }
            guard var reminder = task["reminder"] as? [String: Any],
                  let type = reminder["type"] as? String,
                  type != "never" else { continue }

            if let snoozedUntil = reminder["snoozedUntil"] as? String,
               let snoozeEnd = parseISO(snoozedUntil) {
                if now < snoozeEnd { continue }
                reminder["snoozedUntil"] = NSNull()
                task["reminder"] = reminder
                tasks[index] = task
                changed = true
            }

            let shouldFire: Bool
            switch type {
            case "at-time":
                shouldFire = shouldFireAtTime(reminder: reminder, now: now)
            case "always":
                shouldFire = shouldFireDaily(reminder: reminder, now: now)
            case "before-deadline":
                shouldFire = shouldFireBeforeDeadline(reminder: reminder, task: task, now: now)
            default:
                shouldFire = false
            }

            guard shouldFire else { continue }

            let title = task["title"] as? String ?? "Reminder"
            NotificationHelper.show(title: "⏰ \(title)", body: "Don't forget!")
            AppManager.shared.emitToMain("notch:pulse")

            reminder["lastFiredAt"] = isoString(now)
            if type == "at-time" {
                reminder["type"] = "never"
            }
            task["reminder"] = reminder
            tasks[index] = task
            changed = true
        }

        guard changed else { return }
        data["tasks"] = tasks
        Storage.shared.write(data)
        AppManager.shared.emitToMain("storage:changed")
    }

    // MARK: - Rules

    private func shouldFireAtTime(reminder: [String: Any], now: Date) -> Bool {
        let dateKey = reminder["date"] as? String ?? Self.dateKey(from: now)
        let time = reminder["time"] as? String ?? "12:00"
        guard dateKey == Self.dateKey(from: now) else { return false }
        guard matchesTime(time, now: now) else { return false }
        return !firedToday(reminder: reminder, now: now)
    }

    private func shouldFireDaily(reminder: [String: Any], now: Date) -> Bool {
        let time = reminder["time"] as? String ?? "09:00"
        guard matchesTime(time, now: now) else { return false }
        return !firedToday(reminder: reminder, now: now)
    }

    private func shouldFireBeforeDeadline(
        reminder: [String: Any],
        task: [String: Any],
        now: Date
    ) -> Bool {
        guard let deadlineStr = task["deadline"] as? String,
              let deadline = parseISO(deadlineStr) else { return false }

        let daysUntil = ceil(deadline.timeIntervalSince(now) / 86_400)
        let daysBefore = intValue(reminder["daysBefore"]) ?? 1
        guard daysUntil <= Double(daysBefore), daysUntil >= 0 else { return false }

        let time = reminder["time"] as? String ?? "09:00"
        guard matchesTime(time, now: now) else { return false }
        return !firedToday(reminder: reminder, now: now)
    }

    // MARK: - Helpers

    private func matchesTime(_ time: String, now: Date) -> Bool {
        guard let (hour, minute) = parseClock(time) else { return false }
        let cal = Calendar.current
        return cal.component(.hour, from: now) == hour
            && cal.component(.minute, from: now) == minute
    }

    private func firedToday(reminder: [String: Any], now: Date) -> Bool {
        guard let last = reminder["lastFiredAt"] as? String,
              let lastDate = parseISO(last) else { return false }
        return Calendar.current.isDate(lastDate, inSameDayAs: now)
    }

    private func parseClock(_ time: String) -> (Int, Int)? {
        let parts = time.split(separator: ":")
        guard parts.count >= 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]) else { return nil }
        return (hour, minute)
    }

    private func parseISO(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: value) { return date }

        let fallback = DateFormatter()
        fallback.locale = Locale(identifier: "en_US_POSIX")
        fallback.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        if let date = fallback.date(from: value) { return date }
        fallback.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"
        return fallback.date(from: value)
    }

    private func isoString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func intValue(_ value: Any?) -> Int? {
        if let n = value as? Int { return n }
        if let n = value as? NSNumber { return n.intValue }
        if let s = value as? String { return Int(s) }
        return nil
    }

    static func dateKey(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
