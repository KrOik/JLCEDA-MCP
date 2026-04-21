import type { BridgePlugin } from './plugin-contract.ts';

import { pcbConstraintEnginePlugin } from './pcb-constraint-engine/plugin.ts';
import { pcbGeometryEnginePlugin } from './pcb-geometry-engine/plugin.ts';

class BridgePluginRegistry {
	private readonly plugins = new Map<string, BridgePlugin>();

	public constructor(initialPlugins: BridgePlugin[] = []) {
		for (const plugin of initialPlugins) {
			this.register(plugin);
		}
	}

	public register(plugin: BridgePlugin): void {
		this.plugins.set(plugin.metadata.id, plugin);
	}

	public get(pluginId: string): BridgePlugin {
		const plugin = this.plugins.get(pluginId);
		if (!plugin) {
			throw new Error(`未找到插件: ${pluginId}`);
		}
		return plugin;
	}

	public async execute(pluginId: string, action: string, payload: unknown): Promise<unknown> {
		return await this.get(pluginId).execute(action, payload);
	}
}

export const bridgePluginRegistry = new BridgePluginRegistry([
	pcbConstraintEnginePlugin,
	pcbGeometryEnginePlugin,
]);
