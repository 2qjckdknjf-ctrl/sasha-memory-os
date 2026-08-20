#if canImport(SwiftUI)
import SwiftUI
import AppleCompanionDomain

@MainActor
public final class AppleCompanionPreviewModel: ObservableObject {
    @Published public var session: AppleCompanionAuthSession
    @Published public var permissions: AppleCompanionPermissionSnapshot
    @Published public var queue: [AppleCompanionQueueItem]
    @Published public var transferredObjects: [AppleTransferredObject]
    @Published public var connectionStatusNote: String

    public init(
        session: AppleCompanionAuthSession,
        permissions: AppleCompanionPermissionSnapshot,
        queue: [AppleCompanionQueueItem],
        transferredObjects: [AppleTransferredObject],
        connectionStatusNote: String
    ) {
        self.session = session
        self.permissions = permissions
        self.queue = queue
        self.transferredObjects = transferredObjects
        self.connectionStatusNote = connectionStatusNote
    }

    public static func preview() -> AppleCompanionPreviewModel {
        let seed = AppleCompanionIngestRequest(
            workspaceID: "11111111-1111-4111-8111-111111111111",
            projectID: "sasha-memory-os",
            actorSubjectID: "33333333-3333-4333-8333-333333333301",
            deviceID: "preview-mac",
            connectionID: "88888888-8888-4888-8888-888888888810",
            itemID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            kind: .photo,
            title: "Sprint whiteboard",
            filename: "whiteboard.jpeg",
            mimeType: "image/jpeg",
            observedAt: "2026-08-19T23:15:00.000Z",
            storageMode: .indexed,
            sensitivity: .internalData,
            memoryType: .idea,
            idempotencyKey: "apple-share/preview-mac/whiteboard-1",
            deleteLocalAfterAck: true,
            processNow: false,
            needsCompanionProcessing: true,
            source: .shareExtension,
            identifiers: AppleCompanionIdentifiers(
                localIdentifier: "APPLE-LOCAL-1",
                cloudIdentifier: "APPLE-CLOUD-1"
            ),
            metadata: [
                "album": .string("Sprint Review")
            ]
        )
        let queue = AppleCompanionQueueReducer.enqueue([], payload: seed)
        let transferredObjects = [
            AppleTransferredObject(
                id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                workspaceID: "11111111-1111-4111-8111-111111111111",
                projectID: "sasha-memory-os",
                title: "Shared whiteboard",
                status: "candidate",
                kind: .photo,
                source: .shareExtension,
                sensitivity: .internalData,
                memoryType: .idea,
                sourceEventID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                deviceID: "preview-mac",
                connectionID: "88888888-8888-4888-8888-888888888810",
                itemID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                filename: "whiteboard.jpeg",
                canonicalReference: "apple://photo/APPLE-LOCAL-1",
                observedAt: "2026-08-19T23:15:00.000Z",
                recordedAt: "2026-08-19T23:16:00.000Z",
                deleteLocalAfterAck: true,
                identifiers: AppleCompanionIdentifiers(
                    localIdentifier: "APPLE-LOCAL-1",
                    cloudIdentifier: "APPLE-CLOUD-1"
                )
            ),
            AppleTransferredObject(
                id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                workspaceID: "11111111-1111-4111-8111-111111111111",
                projectID: "sasha-memory-os",
                title: "PhotoKit-selected receipt",
                status: "verified",
                kind: .photo,
                source: .photoLibrary,
                sensitivity: .personal,
                sourceEventID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                deviceID: "preview-mac",
                itemID: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                filename: "receipt.heic",
                canonicalReference: "apple://photo/RECEIPT-LOCAL-1",
                observedAt: "2026-08-19T23:17:00.000Z",
                recordedAt: "2026-08-19T23:18:00.000Z",
                identifiers: AppleCompanionIdentifiers(localIdentifier: "RECEIPT-LOCAL-1")
            )
        ]
        return AppleCompanionPreviewModel(
            session: AppleCompanionAuthSession(
                status: .connected,
                baseURL: "http://localhost:8787",
                subjectID: "33333333-3333-4333-8333-333333333301",
                deviceDisplayName: "Sasha's Mac"
            ),
            permissions: AppleCompanionPermissionSnapshot(
                photoLibrary: .limited,
                files: .notDetermined,
                shareExtension: .full
            ),
            queue: queue,
            transferredObjects: transferredObjects,
            connectionStatusNote: "Slice 05 placeholder: share-contract intake, limited-library permissions, Files bookmarks, transferred-object list/delete, and durable queue status only."
        )
    }

    public func enqueueTextStub() {
        let itemID = UUID().uuidString.lowercased()
        let payload = AppleCompanionSharePayload(
            workspaceID: "11111111-1111-4111-8111-111111111111",
            projectID: "sasha-memory-os",
            actorSubjectID: session.subjectID ?? "33333333-3333-4333-8333-333333333301",
            deviceID: "preview-mac",
            itemID: itemID,
            kind: .text,
            text: "Companion app queued a text stub for later upload.",
            observedAt: AppleCompanionClock.iso8601String(),
            storageMode: .indexed,
            sensitivity: .internalData,
            memoryType: .idea,
            idempotencyKey: "apple-share/preview-mac/\(itemID)",
            deleteLocalAfterAck: true,
            metadata: [
                "shared_from": .string("Preview")
            ]
        )

        guard let mapped = try? AppleCompanionSharePayloadMapper.map(payload) else {
            return
        }
        queue = AppleCompanionQueueReducer.enqueue(queue, payload: mapped.request)
    }

    public func markFirstItemUploading() {
        guard let item = queue.first else { return }
        queue = AppleCompanionQueueReducer.markUploading(queue, itemID: item.id)
    }

    public func markFirstItemFailed() {
        guard let item = queue.first else { return }
        queue = AppleCompanionQueueReducer.markFailed(
            queue,
            itemID: item.id,
            errorMessage: "Network unavailable"
        )
    }

    public func markFirstItemDone() {
        guard let item = queue.first else { return }
        queue = AppleCompanionQueueReducer.markDone(queue, itemID: item.id)
    }

    public func acknowledgeCompleted() {
        guard let item = queue.first(where: { $0.state == .done }) else { return }
        queue = AppleCompanionQueueReducer.acknowledge(queue, itemID: item.id)
    }

    public func deleteTransferredObject(_ object: AppleTransferredObject) {
        transferredObjects.removeAll(where: { $0.id == object.id })
    }
}

public struct MemoryOSAppleCompanionRootView: View {
    @StateObject private var model: AppleCompanionPreviewModel

    public init(model: AppleCompanionPreviewModel = .preview()) {
        _model = StateObject(wrappedValue: model)
    }

    public var body: some View {
        TabView {
            NavigationStack {
                List {
                    Section("Auth session placeholder") {
                        Label(model.session.status.rawValue, systemImage: "person.crop.circle.badge.checkmark")
                        LabeledContent("Base URL", value: model.session.baseURL)
                        LabeledContent("Subject", value: model.session.subjectID ?? "Pending sign-in")
                        LabeledContent("Device", value: model.session.deviceDisplayName)
                    }

                    Section("Connection and permission inspector") {
                        LabeledContent("Photos", value: label(for: model.permissions.photoLibrary))
                        LabeledContent("Files", value: label(for: model.permissions.files))
                        LabeledContent("Share Extension", value: label(for: model.permissions.shareExtension))
                        Text(model.connectionStatusNote)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .navigationTitle("Connection")
            }
            .tabItem {
                Label("Connection", systemImage: "link")
            }

            NavigationStack {
                List(model.queue) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.payload.title)
                            .font(.headline)
                        Text("\(item.payload.kind.rawValue) • \(item.statusLabel.rawValue)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text("Project: \(item.payload.projectID)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let memoryType = item.payload.memoryType {
                            Text("Memory type: \(memoryType.rawValue)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if let lastError = item.lastError {
                            Text(lastError)
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                        if item.deleteLocalAfterAck {
                            Text("Delete local bytes after acknowledgment")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .toolbar {
                    ToolbarItemGroup {
                        Button("Uploading") { model.markFirstItemUploading() }
                        Button("Retry") { model.markFirstItemFailed() }
                        Button("Done") { model.markFirstItemDone() }
                        Button("Ack") { model.acknowledgeCompleted() }
                    }
                }
                .navigationTitle("Queue")
            }
            .tabItem {
                Label("Queue", systemImage: "tray.full")
            }

            NavigationStack {
                List(model.transferredObjects) { object in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(object.title)
                            .font(.headline)
                        Text("\(object.source.rawValue) • \(object.kind.rawValue) • \(object.status)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text("Project: \(object.projectID)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let filename = object.filename {
                            Text(filename)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if let canonicalReference = object.canonicalReference {
                            Text(canonicalReference)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if object.deleteLocalAfterAck {
                            Text("Delete local bytes after acknowledgment")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .swipeActions {
                        Button(role: .destructive) {
                            model.deleteTransferredObject(object)
                        } label: {
                            Text("Delete")
                        }
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Slice 05 contract stub")
                            .font(.headline)
                        Text("Delete calls are placeholders for POST /v1/apple/transferred-objects/:id/delete, which tombstones through the existing memory status path.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .background(.thinMaterial)
                }
                .navigationTitle("Objects")
            }
            .tabItem {
                Label("Objects", systemImage: "externaldrive.badge.checkmark")
            }

            NavigationStack {
                Form {
                    Section("Share item intake stub") {
                        Text("Slice 05 keeps the Share Extension and transferred-object contracts testable in CI. Live PhotoKit enumeration, bookmark resolution, signed appex wiring, and the runtime Share Extension target land in later slices.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Button("Queue shared text contract") {
                            model.enqueueTextStub()
                        }
                    }

                    Section("Planned interfaces") {
                        Label("Document picker placeholder", systemImage: "doc.badge.plus")
                        Label("PhotoKit limited/full placeholder", systemImage: "photo.on.rectangle")
                        Label("Share Extension runtime placeholder", systemImage: "square.and.arrow.up")
                    }
                }
                .navigationTitle("Intake")
            }
            .tabItem {
                Label("Intake", systemImage: "square.and.arrow.down")
            }
        }
    }

    private func label(for state: ApplePermissionState) -> String {
        switch state {
        case .notDetermined:
            return "Not determined"
        case .limited:
            return "Limited"
        case .full:
            return "Full"
        case .denied:
            return "Denied"
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
public struct MemoryOSAppleCompanionAppShell: App {
    public init() {}

    public var body: some Scene {
        WindowGroup {
            MemoryOSAppleCompanionRootView()
        }
    }
}

#Preview {
    MemoryOSAppleCompanionRootView()
}
#endif
