import Foundation

public struct AppleCompanionAuthSession: Codable, Hashable, Sendable {
    public enum Status: String, Codable, Sendable {
        case signedOut = "signed_out"
        case authenticating
        case connected
    }

    public var status: Status
    public var baseURL: String
    public var subjectID: String?
    public var deviceDisplayName: String

    public init(
        status: Status = .signedOut,
        baseURL: String = "http://localhost:8787",
        subjectID: String? = nil,
        deviceDisplayName: String = "This Apple device"
    ) {
        self.status = status
        self.baseURL = baseURL
        self.subjectID = subjectID
        self.deviceDisplayName = deviceDisplayName
    }

    enum CodingKeys: String, CodingKey {
        case status
        case baseURL = "base_url"
        case subjectID = "subject_id"
        case deviceDisplayName = "device_display_name"
    }
}

public protocol AppleCompanionAuthenticating: Sendable {
    var currentSession: AppleCompanionAuthSession? { get }
}

// Slice 05 keeps the native Apple surface contract-only: PhotoKit limited selection, Files bookmarks,
// queue-only Share Extension intake, transferred-object list/delete stubs, security-scoped leases,
// and explicit stale-bookmark reselect flows.
public protocol ApplePhotoLibraryInspecting: Sendable {
    func currentPhotoLibraryCheckpoint() async -> AppleCompanionPhotoLibraryCheckpoint
    func currentPhotoLibrarySelectionDelta(
        since previous: AppleCompanionPhotoLibraryCheckpoint?
    ) async -> AppleCompanionPhotoLibrarySelectionDelta
}

public protocol AppleSecurityScopedLease: Sendable {
    var bookmarkID: String { get }
    func stopAccessing()
}

public protocol AppleDocumentBookmarkManaging: Sendable {
    func currentFilesCheckpoint() async -> AppleCompanionFilesCheckpoint
    func resolveBookmark(
        for identifiers: AppleCompanionIdentifiers
    ) async -> AppleCompanionFileBookmarkResolution
    func startAccessingBookmark(
        _ bookmark: AppleCompanionFileBookmark
    ) async throws -> any AppleSecurityScopedLease
    func reselectBookmarks(_ bookmarkIDs: [String]) async
}

public protocol AppleShareItemIntaking: Sendable {
    func enqueueSharedItem(_ request: AppleCompanionIngestRequest) async throws
}

public protocol AppleTransferredObjectsListing: Sendable {
    func listTransferredObjects(
        _ request: AppleTransferredObjectsListRequest
    ) async throws -> AppleTransferredObjectsListResponse
}

public protocol AppleTransferredObjectDeleting: Sendable {
    func deleteTransferredObject(
        memoryID: String,
        request: AppleTransferredObjectDeleteRequest
    ) async throws
}
