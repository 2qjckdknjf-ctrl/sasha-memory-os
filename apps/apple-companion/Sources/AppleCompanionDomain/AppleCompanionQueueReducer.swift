import Foundation

public enum AppleCompanionQueueReducer {
    public static func enqueue(
        _ queue: [AppleCompanionQueueItem],
        payload: AppleCompanionIngestRequest,
        at timestamp: String = AppleCompanionClock.iso8601String()
    ) -> [AppleCompanionQueueItem] {
        let nextItem = AppleCompanionQueueItem(
            id: payload.itemID,
            state: .pending,
            attemptCount: 0,
            payload: payload,
            deleteLocalAfterAck: payload.deleteLocalAfterAck,
            lastError: nil,
            queuedAt: timestamp,
            updatedAt: timestamp
        )
        return queue.filter { $0.id != payload.itemID } + [nextItem]
    }

    public static func markUploading(
        _ queue: [AppleCompanionQueueItem],
        itemID: String,
        at timestamp: String = AppleCompanionClock.iso8601String()
    ) -> [AppleCompanionQueueItem] {
        queue.map { item in
            guard item.id == itemID else { return item }
            var next = item
            next.state = .uploading
            next.updatedAt = timestamp
            next.lastAttemptAt = timestamp
            next.lastError = nil
            return next
        }
    }

    public static func markFailed(
        _ queue: [AppleCompanionQueueItem],
        itemID: String,
        errorMessage: String,
        at timestamp: String = AppleCompanionClock.iso8601String(),
        retryDelaySeconds: TimeInterval = 60
    ) -> [AppleCompanionQueueItem] {
        let retryDate = Date(timeIntervalSince1970: 0)
        let nextRetry = AppleCompanionClock.date(from: timestamp)
            .map { AppleCompanionClock.iso8601String(from: $0.addingTimeInterval(retryDelaySeconds)) }
            ?? AppleCompanionClock.iso8601String(from: retryDate.addingTimeInterval(retryDelaySeconds))

        return queue.map { item in
            guard item.id == itemID else { return item }
            var next = item
            next.state = .failed
            next.attemptCount += 1
            next.updatedAt = timestamp
            next.lastAttemptAt = timestamp
            next.lastError = errorMessage
            next.nextRetryAt = nextRetry
            return next
        }
    }

    public static func markDone(
        _ queue: [AppleCompanionQueueItem],
        itemID: String,
        at timestamp: String = AppleCompanionClock.iso8601String()
    ) -> [AppleCompanionQueueItem] {
        queue.map { item in
            guard item.id == itemID else { return item }
            var next = item
            next.state = .done
            next.updatedAt = timestamp
            next.completedAt = timestamp
            next.lastError = nil
            next.nextRetryAt = nil
            return next
        }
    }

    public static func acknowledge(
        _ queue: [AppleCompanionQueueItem],
        itemID: String
    ) -> [AppleCompanionQueueItem] {
        queue.filter { $0.id != itemID }
    }
}
