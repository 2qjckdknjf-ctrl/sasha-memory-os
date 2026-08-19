import Foundation

// Mirrors packages/schemas/src/appleCompanion.ts for Slice 01.
public enum ApplePermissionState: String, Codable, CaseIterable, Sendable {
    case notDetermined = "not_determined"
    case limited
    case full
    case denied
}

public enum AppleCompanionSource: String, Codable, CaseIterable, Sendable {
    case companionApp = "companion_app"
    case shareExtension = "share_extension"
    case documentPicker = "document_picker"
    case photoLibrary = "photo_library"
    case manual
}

public enum AppleCompanionItemKind: String, Codable, CaseIterable, Sendable {
    case text
    case file
    case photo
    case url
}

public enum AppleStorageMode: String, Codable, CaseIterable, Sendable {
    case reference
    case indexed
    case archived
}

public enum AppleSensitivity: String, Codable, CaseIterable, Sendable {
    case publicData = "public"
    case internalData = "internal"
    case personal
    case confidential
    case restricted
}

public enum AppleCompanionQueueState: String, Codable, CaseIterable, Sendable {
    case pending
    case uploading
    case failed
    case done
}

public enum JSONValue: Codable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.typeMismatch(
                JSONValue.self,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Unsupported JSON value"
                )
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}

public struct AppleCompanionPermissionSnapshot: Codable, Hashable, Sendable {
    public var photoLibrary: ApplePermissionState
    public var files: ApplePermissionState
    public var shareExtension: ApplePermissionState

    public init(
        photoLibrary: ApplePermissionState = .notDetermined,
        files: ApplePermissionState = .notDetermined,
        shareExtension: ApplePermissionState = .notDetermined
    ) {
        self.photoLibrary = photoLibrary
        self.files = files
        self.shareExtension = shareExtension
    }

    enum CodingKeys: String, CodingKey {
        case photoLibrary = "photo_library"
        case files
        case shareExtension = "share_extension"
    }
}

public struct AppleCompanionIdentifiers: Codable, Hashable, Sendable {
    public var localIdentifier: String?
    public var cloudIdentifier: String?
    public var providerItemIdentifier: String?

    public init(
        localIdentifier: String? = nil,
        cloudIdentifier: String? = nil,
        providerItemIdentifier: String? = nil
    ) {
        self.localIdentifier = localIdentifier
        self.cloudIdentifier = cloudIdentifier
        self.providerItemIdentifier = providerItemIdentifier
    }

    enum CodingKeys: String, CodingKey {
        case localIdentifier = "local_identifier"
        case cloudIdentifier = "cloud_identifier"
        case providerItemIdentifier = "provider_item_identifier"
    }
}

public struct AppleCompanionIngestRequest: Codable, Hashable, Identifiable, Sendable {
    public var workspaceID: String
    public var projectID: String
    public var actorSubjectID: String
    public var deviceID: String
    public var connectionID: String?
    public var itemID: String
    public var kind: AppleCompanionItemKind
    public var title: String
    public var text: String?
    public var url: String?
    public var filename: String?
    public var mimeType: String?
    public var observedAt: String?
    public var externalVersion: String?
    public var storageMode: AppleStorageMode
    public var sensitivity: AppleSensitivity
    public var idempotencyKey: String
    public var deleteLocalAfterAck: Bool
    public var processNow: Bool
    public var source: AppleCompanionSource
    public var identifiers: AppleCompanionIdentifiers
    public var metadata: [String: JSONValue]

    public var id: String { itemID }

    public init(
        workspaceID: String,
        projectID: String,
        actorSubjectID: String,
        deviceID: String,
        connectionID: String? = nil,
        itemID: String,
        kind: AppleCompanionItemKind,
        title: String,
        text: String? = nil,
        url: String? = nil,
        filename: String? = nil,
        mimeType: String? = nil,
        observedAt: String? = nil,
        externalVersion: String? = nil,
        storageMode: AppleStorageMode = .reference,
        sensitivity: AppleSensitivity = .internalData,
        idempotencyKey: String,
        deleteLocalAfterAck: Bool = false,
        processNow: Bool = false,
        source: AppleCompanionSource = .companionApp,
        identifiers: AppleCompanionIdentifiers = .init(),
        metadata: [String: JSONValue] = [:]
    ) {
        self.workspaceID = workspaceID
        self.projectID = projectID
        self.actorSubjectID = actorSubjectID
        self.deviceID = deviceID
        self.connectionID = connectionID
        self.itemID = itemID
        self.kind = kind
        self.title = title
        self.text = text
        self.url = url
        self.filename = filename
        self.mimeType = mimeType
        self.observedAt = observedAt
        self.externalVersion = externalVersion
        self.storageMode = storageMode
        self.sensitivity = sensitivity
        self.idempotencyKey = idempotencyKey
        self.deleteLocalAfterAck = deleteLocalAfterAck
        self.processNow = processNow
        self.source = source
        self.identifiers = identifiers
        self.metadata = metadata
    }

    enum CodingKeys: String, CodingKey {
        case workspaceID = "workspace_id"
        case projectID = "project_id"
        case actorSubjectID = "actor_subject_id"
        case deviceID = "device_id"
        case connectionID = "connection_id"
        case itemID = "item_id"
        case kind
        case title
        case text
        case url
        case filename
        case mimeType = "mime_type"
        case observedAt = "observed_at"
        case externalVersion = "external_version"
        case storageMode = "storage_mode"
        case sensitivity
        case idempotencyKey = "idempotency_key"
        case deleteLocalAfterAck = "delete_local_after_ack"
        case processNow = "process_now"
        case source
        case identifiers
        case metadata
    }
}

public struct AppleCompanionQueueItem: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var state: AppleCompanionQueueState
    public var attemptCount: Int
    public var payload: AppleCompanionIngestRequest
    public var deleteLocalAfterAck: Bool
    public var lastError: String?
    public var queuedAt: String
    public var updatedAt: String
    public var lastAttemptAt: String?
    public var nextRetryAt: String?
    public var completedAt: String?

    public init(
        id: String,
        state: AppleCompanionQueueState = .pending,
        attemptCount: Int = 0,
        payload: AppleCompanionIngestRequest,
        deleteLocalAfterAck: Bool,
        lastError: String? = nil,
        queuedAt: String,
        updatedAt: String,
        lastAttemptAt: String? = nil,
        nextRetryAt: String? = nil,
        completedAt: String? = nil
    ) {
        self.id = id
        self.state = state
        self.attemptCount = attemptCount
        self.payload = payload
        self.deleteLocalAfterAck = deleteLocalAfterAck
        self.lastError = lastError
        self.queuedAt = queuedAt
        self.updatedAt = updatedAt
        self.lastAttemptAt = lastAttemptAt
        self.nextRetryAt = nextRetryAt
        self.completedAt = completedAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case state
        case attemptCount = "attempt_count"
        case payload
        case deleteLocalAfterAck = "delete_local_after_ack"
        case lastError = "last_error"
        case queuedAt = "queued_at"
        case updatedAt = "updated_at"
        case lastAttemptAt = "last_attempt_at"
        case nextRetryAt = "next_retry_at"
        case completedAt = "completed_at"
    }
}

public enum AppleCompanionClock {
    private static let formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    public static func iso8601String(from date: Date = Date()) -> String {
        formatter.string(from: date)
    }

    public static func date(from value: String) -> Date? {
        formatter.date(from: value)
    }
}
