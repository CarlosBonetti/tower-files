// The "All files" pane: a renderer framed on a floor's shelf. A placeholder for now.
const { settings } = await tower.renderer()
document.getElementById('floor').textContent = settings.project ?? ''
