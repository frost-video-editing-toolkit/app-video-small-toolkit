const { app, BrowserWindow } = require('electron');
const path = require('path');

if (require('electron-squirrel-startup')) {
	app.quit();
}

function createWindow() {
	const win = new BrowserWindow({
		width: 1024,
		height: 768,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '..', 'ui', 'build', 'index.html')}`;
	win.loadURL(startUrl);
	// win.webContents.openDevTools();
}

app.on('ready', createWindow);
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});