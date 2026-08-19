import Foundation

public enum ShareExtensionIntakeError: Error, Equatable, Sendable {
    case missingProjectID
    case missingText
    case missingURL
    case missingFilename
}

public struct AppleCompanionShareMapping: Sendable {
    public let request: AppleCompanionIngestRequest
    public let queueItem: AppleCompanionQueueItem

    public init(request: AppleCompanionIngestRequest, queueItem: AppleCompanionQueueItem) {
        self.request = request
        self.queueItem = queueItem
    }
}

public enum AppleCompanionSharePayloadMapper {
    public static func map(
        _ share: AppleCompanionSharePayload,
        queuedAt: String = AppleCompanionClock.iso8601String()
    ) throws -> AppleCompanionShareMapping {
        let trimmedProjectID = share.projectID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedProjectID.isEmpty else {
            throw ShareExtensionIntakeError.missingProjectID
        }

        let request = AppleCompanionIngestRequest(
            workspaceID: share.workspaceID,
            projectID: trimmedProjectID,
            actorSubjectID: share.actorSubjectID,
            deviceID: share.deviceID,
            connectionID: share.connectionID,
            itemID: share.itemID,
            kind: ingestKind(for: share.kind),
            title: try resolveTitle(for: share),
            text: share.text,
            url: share.url,
            filename: share.filename,
            mimeType: share.mimeType,
            observedAt: share.observedAt,
            storageMode: share.storageMode,
            sensitivity: share.sensitivity,
            memoryType: share.memoryType,
            idempotencyKey: share.idempotencyKey,
            deleteLocalAfterAck: share.deleteLocalAfterAck,
            processNow: false,
            needsCompanionProcessing: true,
            source: .shareExtension,
            identifiers: share.identifiers,
            metadata: share.metadata
        )
        let queueItem = AppleCompanionQueueReducer.enqueue([], payload: request, at: queuedAt).last
            ?? AppleCompanionQueueItem(
                id: request.itemID,
                payload: request,
                deleteLocalAfterAck: request.deleteLocalAfterAck,
                queuedAt: queuedAt,
                updatedAt: queuedAt
            )
        return AppleCompanionShareMapping(request: request, queueItem: queueItem)
    }

    private static func ingestKind(for kind: AppleCompanionShareKind) -> AppleCompanionItemKind {
        switch kind {
        case .text:
            return .text
        case .file:
            return .file
        case .photo:
            return .photo
        case .video:
            return .video
        case .url:
            return .url
        }
    }

    private static func resolveTitle(for share: AppleCompanionSharePayload) throws -> String {
        if let title = share.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            return title
        }

        switch share.kind {
        case .text:
            guard let text = share.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
                throw ShareExtensionIntakeError.missingText
            }
            return String(text.prefix(120))
        case .url:
            guard let url = share.url, !url.isEmpty else {
                throw ShareExtensionIntakeError.missingURL
            }
            return url
        case .photo, .video, .file:
            guard let filename = share.filename, !filename.isEmpty else {
                throw ShareExtensionIntakeError.missingFilename
            }
            return filename
        }
    }
}

// Slice 04 remains contract-only: the live app extension target and signed appex arrive later.
public actor ShareExtensionIntake: AppleShareItemIntaking {
    private var queue: [AppleCompanionQueueItem]

    public init(queue: [AppleCompanionQueueItem] = []) {
        self.queue = queue
    }

    public func enqueueSharedItem(_ request: AppleCompanionIngestRequest) async throws {
        queue = AppleCompanionQueueReducer.enqueue(queue, payload: request)
    }

    public func enqueueSharePayload(
        _ share: AppleCompanionSharePayload,
        queuedAt: String = AppleCompanionClock.iso8601String()
    ) async throws -> AppleCompanionQueueItem {
        let mapped = try AppleCompanionSharePayloadMapper.map(share, queuedAt: queuedAt)
        queue = AppleCompanionQueueReducer.enqueue(queue, payload: mapped.request, at: queuedAt)
        return mapped.queueItem
    }

    public func currentQueue() -> [AppleCompanionQueueItem] {
        queue
    }
}
