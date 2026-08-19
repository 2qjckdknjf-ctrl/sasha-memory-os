import Foundation

public enum AppleCompanionQueueReducer {
    private static func resolveStatusLabel(
        state: AppleCompanionQueueState,
        lastErrorCode: AppleCompanionQueueErrorCode?
    ) -> AppleCompanionVisibleQueueState {
        if lastErrorCode == .reselectRequired {
            return .reselectRequired
        }
        switch state {
        case .pending:
            return .pending
        case .uploading:
            return .uploading
        case .failed:
            return .failed
        case .done:
            return .done
        }
    }

    public static func enqueue(
        _ queue: [AppleCompanionQueueItem],
        payload: AppleCompanionIngestRequest,
        at timestamp: String = AppleCompanionClock.iso8601String()
    ) -> [AppleCompanionQueueItem] {
        let nextItem = AppleCompanionQueueItem(
            id: payload.itemID,
            state: .pending,
            statusLabel: .pending,
            attemptCount: 0,
            payload: payload,
            deleteLocalAfterAck: payload.deleteLocalAfterAck,
            lastError: nil,
            lastErrorCode: nil,
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
            next.statusLabel = .uploading
            next.updatedAt = timestamp
            next.lastAttemptAt = timestamp
            next.lastError = nil
            next.lastErrorCode = nil
            return next
        }
    }

    public static func markFailed(
        _ queue: [AppleCompanionQueueItem],
        itemID: String,
        errorMessage: String,
        at timestamp: String = AppleCompanionClock.iso8601String(),
        retryDelaySeconds: TimeInterval? = 60,
        errorCode: AppleCompanionQueueErrorCode? = nil
    ) -> [AppleCompanionQueueItem] {
        let retryDate = Date(timeIntervalSince1970: 0)
        let nextRetry = retryDelaySeconds.map { delay in
            AppleCompanionClock.date(from: timestamp)
                .map { AppleCompanionClock.iso8601String(from: $0.addingTimeInterval(delay)) }
                ?? AppleCompanionClock.iso8601String(from: retryDate.addingTimeInterval(delay))
        }

        return queue.map { item in
            guard item.id == itemID else { return item }
            var next = item
            next.state = .failed
            next.attemptCount += 1
            next.updatedAt = timestamp
            next.lastAttemptAt = timestamp
            next.lastError = errorMessage
            next.lastErrorCode = errorCode
            next.nextRetryAt = nextRetry
            next.statusLabel = resolveStatusLabel(state: .failed, lastErrorCode: errorCode)
            return next
        }
    }

    public static func markReselectRequired(
        _ queue: [AppleCompanionQueueItem],
        itemID: String,
        at timestamp: String = AppleCompanionClock.iso8601String()
    ) -> [AppleCompanionQueueItem] {
        markFailed(
            queue,
            itemID: itemID,
            errorMessage: "reselect_required",
            at: timestamp,
            retryDelaySeconds: nil,
            errorCode: .reselectRequired
        )
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
            next.statusLabel = .done
            next.updatedAt = timestamp
            next.completedAt = timestamp
            next.lastError = nil
            next.lastErrorCode = nil
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
