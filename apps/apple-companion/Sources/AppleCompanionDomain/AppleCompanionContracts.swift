import Foundation

// Mirrors packages/schemas/src/appleCompanion.ts for Slice 03.
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

public enum AppleCompanionSelectionErrorCode: String, Codable, CaseIterable, Sendable {
    case outOfScope = "out_of_scope"
    case reselectRequired = "reselect_required"
}

public enum AppleCompanionQueueErrorCode: String, Codable, CaseIterable, Sendable {
    case reselectRequired = "reselect_required"
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

public struct AppleCompanionSelectedAsset: Codable, Hashable, Sendable {
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

public struct AppleCompanionPhotoLibraryCheckpoint: Codable, Hashable, Sendable {
    public var permissionState: ApplePermissionState
    public var selectedAssets: [AppleCompanionSelectedAsset]
    public var changeToken: String?

    public init(
        permissionState: ApplePermissionState = .notDetermined,
        selectedAssets: [AppleCompanionSelectedAsset] = [],
        changeToken: String? = nil
    ) {
        self.permissionState = permissionState
        self.selectedAssets = selectedAssets
        self.changeToken = changeToken
    }

    enum CodingKeys: String, CodingKey {
        case permissionState = "permission_state"
        case selectedAssets = "selected_assets"
        case changeToken = "change_token"
    }
}

public struct AppleCompanionPhotoLibrarySelectionDelta: Codable, Hashable, Sendable {
    public var added: [AppleCompanionSelectedAsset]
    public var removed: [AppleCompanionSelectedAsset]
    public var updated: [AppleCompanionSelectedAsset]

    public init(
        added: [AppleCompanionSelectedAsset] = [],
        removed: [AppleCompanionSelectedAsset] = [],
        updated: [AppleCompanionSelectedAsset] = []
    ) {
        self.added = added
        self.removed = removed
        self.updated = updated
    }
}

public struct AppleCompanionFileBookmark: Codable, Hashable, Sendable {
    public var bookmarkID: String
    public var displayName: String
    public var isDirectory: Bool
    public var providerItemIdentifier: String
    public var securityScopedBookmark: String
    public var lastAccessedAt: String?
    public var stale: Bool

    public init(
        bookmarkID: String,
        displayName: String,
        isDirectory: Bool,
        providerItemIdentifier: String,
        securityScopedBookmark: String,
        lastAccessedAt: String? = nil,
        stale: Bool = false
    ) {
        self.bookmarkID = bookmarkID
        self.displayName = displayName
        self.isDirectory = isDirectory
        self.providerItemIdentifier = providerItemIdentifier
        self.securityScopedBookmark = securityScopedBookmark
        self.lastAccessedAt = lastAccessedAt
        self.stale = stale
    }

    enum CodingKeys: String, CodingKey {
        case bookmarkID = "bookmark_id"
        case displayName = "display_name"
        case isDirectory = "is_directory"
        case providerItemIdentifier = "provider_item_identifier"
        case securityScopedBookmark = "security_scoped_bookmark"
        case lastAccessedAt = "last_accessed_at"
        case stale
    }
}

public struct AppleCompanionFolderMonitorCheckpoint: Codable, Hashable, Sendable {
    public var bookmarkID: String
    public var providerItemIdentifier: String
    public var changeToken: String?

    public init(
        bookmarkID: String,
        providerItemIdentifier: String,
        changeToken: String? = nil
    ) {
        self.bookmarkID = bookmarkID
        self.providerItemIdentifier = providerItemIdentifier
        self.changeToken = changeToken
    }

    enum CodingKeys: String, CodingKey {
        case bookmarkID = "bookmark_id"
        case providerItemIdentifier = "provider_item_identifier"
        case changeToken = "change_token"
    }
}

public struct AppleCompanionFilesCheckpoint: Codable, Hashable, Sendable {
    public var permissionState: ApplePermissionState
    public var selectedBookmarks: [AppleCompanionFileBookmark]
    public var folderCheckpoints: [AppleCompanionFolderMonitorCheckpoint]

    public init(
        permissionState: ApplePermissionState = .notDetermined,
        selectedBookmarks: [AppleCompanionFileBookmark] = [],
        folderCheckpoints: [AppleCompanionFolderMonitorCheckpoint] = []
    ) {
        self.permissionState = permissionState
        self.selectedBookmarks = selectedBookmarks
        self.folderCheckpoints = folderCheckpoints
    }

    enum CodingKeys: String, CodingKey {
        case permissionState = "permission_state"
        case selectedBookmarks = "selected_bookmarks"
        case folderCheckpoints = "folder_checkpoints"
    }
}

public enum AppleCompanionFileBookmarkResolutionStatus: String, Codable, CaseIterable, Sendable {
    case granted
    case outOfScope = "out_of_scope"
    case reselectRequired = "reselect_required"
}

public struct AppleCompanionFileBookmarkResolution: Codable, Hashable, Sendable {
    public var status: AppleCompanionFileBookmarkResolutionStatus
    public var bookmark: AppleCompanionFileBookmark?
    public var errorCode: AppleCompanionSelectionErrorCode?
    public var staleBookmarkIDs: [String]

    public init(
        status: AppleCompanionFileBookmarkResolutionStatus,
        bookmark: AppleCompanionFileBookmark? = nil,
        errorCode: AppleCompanionSelectionErrorCode? = nil,
        staleBookmarkIDs: [String] = []
    ) {
        self.status = status
        self.bookmark = bookmark
        self.errorCode = errorCode
        self.staleBookmarkIDs = staleBookmarkIDs
    }

    enum CodingKeys: String, CodingKey {
        case status
        case bookmark
        case errorCode = "error_code"
        case staleBookmarkIDs = "stale_bookmark_ids"
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
    public var lastErrorCode: AppleCompanionQueueErrorCode?
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
        lastErrorCode: AppleCompanionQueueErrorCode? = nil,
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
        self.lastErrorCode = lastErrorCode
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
        case lastErrorCode = "last_error_code"
        case queuedAt = "queued_at"
        case updatedAt = "updated_at"
        case lastAttemptAt = "last_attempt_at"
        case nextRetryAt = "next_retry_at"
        case completedAt = "completed_at"
    }
}

public struct AppleCompanionDeviceQueueCursor: Codable, Hashable, Sendable {
    public var photoLibrary: AppleCompanionPhotoLibraryCheckpoint?
    public var files: AppleCompanionFilesCheckpoint?

    public init(
        photoLibrary: AppleCompanionPhotoLibraryCheckpoint? = nil,
        files: AppleCompanionFilesCheckpoint? = nil
    ) {
        self.photoLibrary = photoLibrary
        self.files = files
    }

    enum CodingKeys: String, CodingKey {
        case photoLibrary = "photo_library"
        case files
    }
}

public struct AppleCompanionQueueSnapshot: Codable, Hashable, Sendable {
    public var items: [AppleCompanionQueueItem]
    public var cursor: AppleCompanionDeviceQueueCursor

    public init(
        items: [AppleCompanionQueueItem] = [],
        cursor: AppleCompanionDeviceQueueCursor = .init()
    ) {
        self.items = items
        self.cursor = cursor
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
