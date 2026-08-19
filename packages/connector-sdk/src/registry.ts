import {
  parseConnectorManifest,
  type ConnectorManifest,
  type RegisteredConnector,
} from './contract.js';

export class ConnectorRegistry {
  private readonly connectors = new Map<string, RegisteredConnector<any>>();

  constructor(initialConnectors: RegisteredConnector<any>[] = []) {
    for (const connector of initialConnectors) {
      this.register(connector);
    }
  }

  register(connector: RegisteredConnector<any>): RegisteredConnector<any> {
    const manifest = parseConnectorManifest(connector.manifest);
    const registered = {
      manifest,
      lifecycle: connector.lifecycle,
    } satisfies RegisteredConnector<any>;
    this.connectors.set(manifest.id, registered);
    return registered;
  }

  get(connectorId: string): RegisteredConnector<any> | null {
    return this.connectors.get(connectorId) ?? null;
  }

  require(connectorId: string): RegisteredConnector<any> {
    const connector = this.get(connectorId);
    if (!connector) {
      throw new Error(`connector not registered: ${connectorId}`);
    }
    return connector;
  }

  has(connectorId: string): boolean {
    return this.connectors.has(connectorId);
  }

  list(): ConnectorManifest[] {
    return [...this.connectors.values()].map((connector) => connector.manifest);
  }
}

export function createConnectorRegistry(
  initialConnectors: RegisteredConnector<any>[] = [],
): ConnectorRegistry {
  return new ConnectorRegistry(initialConnectors);
}
