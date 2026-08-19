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

public protocol ApplePhotoLibraryInspecting: Sendable {
    func currentPhotoLibraryPermission() async -> ApplePermissionState
}

public protocol AppleDocumentBookmarkManaging: Sendable {
    func currentFilesPermission() async -> ApplePermissionState
    func reselectStaleBookmark() async
}

public protocol AppleShareItemIntaking: Sendable {
    func enqueueSharedItem(_ request: AppleCompanionIngestRequest) async throws
}
