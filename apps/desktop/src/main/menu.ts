import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import type { EditorTheme } from '@codesigner/protocol';

/**
 * Native menu. Canvas commands (undo, zoom, wrap in stack…) are forwarded to the
 * editor, which decides whether a text field or the canvas handles them.
 */
export function buildMenu(send: (command: string) => void, theme: { current: EditorTheme; set: (theme: EditorTheme) => void }): Menu {
	const appearance = (label: string, value: EditorTheme): MenuItemConstructorOptions => ({
		label,
		type: 'radio',
		checked: theme.current === value,
		click: () => theme.set(value)
	});
	const cmd = (label: string, command: string, accelerator?: string): MenuItemConstructorOptions => ({
		label,
		accelerator,
		click: () => send(command)
	});
	const isMac = process.platform === 'darwin';

	const template: MenuItemConstructorOptions[] = [
		...(isMac
			? [
					{
						label: app.name,
						submenu: [
							{ role: 'about' },
							{ type: 'separator' },
							cmd('Settings…', 'open-settings', 'CmdOrCtrl+,'),
							{ type: 'separator' },
							{ role: 'hide' },
							{ role: 'hideOthers' },
							{ role: 'unhide' },
							{ type: 'separator' },
							{ role: 'quit' }
						]
					} satisfies MenuItemConstructorOptions
				]
			: []),
		{
			label: 'File',
			submenu: [
				cmd('Open Project…', 'open-project', 'CmdOrCtrl+O'),
				cmd('New Branch…', 'new-branch', 'CmdOrCtrl+Shift+B'),
				cmd('Version History…', 'version-history', 'CmdOrCtrl+Shift+H'),
				{ type: 'separator' },
				cmd('Open in Code Editor', 'open-in-editor', 'CmdOrCtrl+Shift+O'),
				{ type: 'separator' },
				isMac ? { role: 'close' } : { role: 'quit' }
			]
		},
		{
			label: 'Edit',
			submenu: [
				cmd('Undo', 'undo', 'CmdOrCtrl+Z'),
				cmd('Redo', 'redo', 'CmdOrCtrl+Shift+Z'),
				{ type: 'separator' },
				{ role: 'cut' },
				{ role: 'copy' },
				{ role: 'paste' },
				{ role: 'selectAll' },
				{ type: 'separator' },
				cmd('Create Component…', 'create-component', 'CmdOrCtrl+Alt+K'),
				{ type: 'separator' },
				cmd('Copy Style', 'copy-style', 'CmdOrCtrl+Alt+C'),
				cmd('Paste Style', 'paste-style', 'CmdOrCtrl+Alt+V')
			]
		},
		{
			label: 'View',
			submenu: [
				cmd('Zoom In', 'zoom-in', 'CmdOrCtrl+='),
				cmd('Zoom Out', 'zoom-out', 'CmdOrCtrl+-'),
				cmd('Zoom to 100%', 'zoom-reset', 'CmdOrCtrl+0'),
				cmd('Zoom to Fit', 'zoom-fit', 'CmdOrCtrl+1'),
				cmd('Zoom to Selection', 'zoom-selection', 'CmdOrCtrl+2'),
				{ type: 'separator' },
				cmd('Reload Canvas', 'reload-canvas', 'CmdOrCtrl+R'),
				cmd('Toggle Interact Mode', 'toggle-interact', 'CmdOrCtrl+E'),
				cmd('Toggle Code', 'toggle-code', 'CmdOrCtrl+J'),
				{ type: 'separator' },
				{ label: 'Appearance', submenu: [appearance('System', 'system'), appearance('Light', 'light'), appearance('Dark', 'dark')] },
				{ type: 'separator' },
				{ role: 'toggleDevTools', label: 'Editor Developer Tools' },
				cmd('Canvas Developer Tools', 'canvas-devtools', 'CmdOrCtrl+Alt+I'),
				{ type: 'separator' },
				{ role: 'togglefullscreen' }
			]
		},
		{ role: 'windowMenu' },
		{
			role: 'help',
			submenu: [cmd('Keyboard Shortcuts', 'show-shortcuts', 'CmdOrCtrl+/')]
		}
	];

	return Menu.buildFromTemplate(template);
}
