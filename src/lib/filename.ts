export function downloadFileName(title: string | undefined, ext = 'mp4'): string {
	const base = (title ?? '')
		.trim()
		.replace(/[\\/:*?"<>|]+/g, ' ')
		.replace(/\s+/g, ' ')
		.slice(0, 80)
		.trim()
		.replace(/[. ]+$/g, '');
	return `${base || 'video'}.${ext.replace(/^\./, '')}`;
}

export function contentDisposition(filename: string): string {
	const asciiRaw = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
	const ascii = /[A-Za-z0-9]/.test(asciiRaw) ? asciiRaw : `video${filename.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '.mp4'}`;
	const encoded = encodeURIComponent(filename).replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
