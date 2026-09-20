import { createElement, useEffect, useRef, type RefObject } from 'react';

export type HyperframesPlayerElement = HTMLElement & {
	play: () => void;
	pause: () => void;
	seek: (time: number) => void;
	currentTime: number;
	duration: number;
};

export function CompositionPlayer({
	src,
	width,
	height,
	playerRef,
}: {
	src: string;
	width: number;
	height: number;
	playerRef?: RefObject<HyperframesPlayerElement | null>;
}) {
	const localRef = useRef<HyperframesPlayerElement | null>(null);

	useEffect(() => {
		const node = localRef.current;
		if (!node) return;
		node.setAttribute('src', src);
		node.setAttribute('controls', '');
		node.setAttribute('runtime-src', '/hf-runtime.js');
		node.removeAttribute('muted');
	}, [src]);

	return createElement('hyperframes-player', {
		ref: (node: HyperframesPlayerElement | null) => {
			localRef.current = node;
			if (playerRef) playerRef.current = node;
		},
		src,
		controls: '',
		'runtime-src': '/hf-runtime.js',
		style: {
			width: '100%',
			height: '100%',
			aspectRatio: `${width} / ${height}`,
		},
	});
}
