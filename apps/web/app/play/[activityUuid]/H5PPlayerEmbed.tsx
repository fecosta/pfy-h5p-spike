'use client';

import { useEffect, useRef, useState } from 'react';

import { RUNTIME_URL, startAttempt } from '../../../lib/runtime';

/**
 * Embeds the H5P player from another origin.
 *
 * Three constraints drive this component's shape, all verified rather than
 * assumed:
 *
 *  1. `@lumieducation/h5p-webcomponents` evaluates `class H5PPlayerComponent
 *     extends HTMLElement` at import time, so importing it during SSR throws
 *     ("HTMLElement is not defined"). It must be imported inside an effect.
 *  2. Custom elements are not registered on import; `defineElements()` must be
 *     called explicitly, and only once per page.
 *  3. The model Lumi returns carries relative URLs, which would resolve against
 *     :3000. The runtime's embed route rewrites them to absolute URLs first.
 *  4. The component matches the rendered H5P instance by comparing
 *     `h5pInstance.contentId == this.contentId` (the `content-id` attribute),
 *     so that attribute MUST hold Lumi's content id — a PFY activity uuid
 *     there silently prevents `initialized` from ever firing. The PFY uuid
 *     stays the address in the URL and the API; the runtime id is fetched with
 *     the model and used only for this attribute.
 *
 * `@lumieducation/h5p-react` is deliberately NOT used: it declares
 * `react: 18.3.1` as a hard dependency (not a peer), so it would pull a second
 * React copy into a React 19 app. The web components carry no React at all.
 */
export default function H5PPlayerEmbed({ activityUuid }: { activityUuid: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('loading…');
  const [events, setEvents] = useState<string[]>([]);
  const [attemptNumber, setAttemptNumber] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let element: any;

    (async () => {
      try {
        const { defineElements } = await import('@lumieducation/h5p-webcomponents');
        defineElements('h5p-player');
        if (cancelled || !hostRef.current) return;

        const { token, attempt } = await startAttempt(activityUuid);
        if (cancelled) return;
        setAttemptNumber(attempt.attempt_number);

        // Resolve the model by PFY uuid first; the runtime id only becomes
        // known here, from the model itself.
        const modelRes = await fetch(
          `${RUNTIME_URL}/api/activities/${activityUuid}/player-model?t=${encodeURIComponent(token)}`,
          { credentials: 'omit' }
        );
        if (!modelRes.ok) throw new Error(`player model ${modelRes.status}`);
        const playerModel = await modelRes.json();
        if (cancelled) return;

        element = document.createElement('h5p-player');
        element.setAttribute('content-id', String(playerModel.contentId));
        element.loadContentCallback = async () => playerModel;

        element.addEventListener('initialized', () => setStatus('ready'));

        // The component re-emits H5P.externalDispatcher's xAPI events. This is
        // the only place statements exist — h5p-server has no xAPI endpoint.
        element.addEventListener('xAPI', (event: any) => {
          const statement = event?.detail?.statement;
          const verb: string = statement?.verb?.id ?? '';
          setEvents((prev) => [...prev, verb.split('/').pop() ?? verb]);

          fetch(`${RUNTIME_URL}/api/xapi`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, statement })
          }).catch(() => undefined);
        });

        hostRef.current.appendChild(element);
      } catch (error: any) {
        if (!cancelled) setStatus(`failed: ${error?.message ?? error}`);
      }
    })();

    return () => {
      cancelled = true;
      element?.remove();
    };
  }, [activityUuid]);

  return (
    <section>
      <p style={{ color: '#6b7280' }}>
        status: <span data-testid="embed-status">{status}</span>
        {attemptNumber !== null && (
          <>
            {' '}
            · attempt <span data-testid="embed-attempt">#{attemptNumber}</span>
          </>
        )}
      </p>
      <div ref={hostRef} data-testid="h5p-host" />
      <pre
        data-testid="xapi-log"
        style={{ background: '#111827', color: '#d1fae5', padding: 8, fontSize: 12 }}
      >
        {events.join('\n')}
      </pre>
    </section>
  );
}
