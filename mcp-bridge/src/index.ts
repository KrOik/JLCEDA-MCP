/**
 * ------------------------------------------------------------------------
 * 名称：Bridge 扩展入口
 * 说明：负责扩展激活、桥接轮询启动与对外菜单函数导出。
 * 作者：Lion
 * 邮箱：chengbin@3578.cn
 * 日期：2026-03-09
 * 备注：嘉立创 EDA Bridge 入口文件。
 * ------------------------------------------------------------------------
 */
import * as extensionConfig from '../extension.json';
import { startBridgeRuntime } from './runtime/bridge-runtime';

/**
 * 激活 Bridge 扩展。
 *
 * @param status 扩展激活状态。
 * @param arg 扩展激活附加参数。
 */
// eslint-disable-next-line unused-imports/no-unused-vars
export function activate(status?: 'onStartupFinished', arg?: string): void {
	// 扩展启动后自动拉起桥接轮询进程。
	startBridgeRuntime();
}

/**
 * 打开连接设置页面。
 *
 * 页面用于配置 MCP 服务器地址并查看连接状态。
 */
export function openSettingsPage(): void {
	void eda.sys_IFrame.openIFrame('/iframe/settings.html', 600, 420, 'jlc-mcp-settings-dialog', { minimizeButton: true, minimizeStyle: 'collapsed' });
}

/**
 * 打开关于信息弹窗。
 */
export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		eda.sys_I18n.text('MCP Bridge', undefined, undefined, extensionConfig.version),
		eda.sys_I18n.text('About'),
	);
}
