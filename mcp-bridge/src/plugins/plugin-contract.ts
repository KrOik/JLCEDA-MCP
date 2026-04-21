export interface BridgePluginMetadata {
	id: string;
	version: string;
	displayName: string;
}

export interface BridgePlugin {
	readonly metadata: BridgePluginMetadata;
	execute: (action: string, payload: unknown) => Promise<unknown>;
}
