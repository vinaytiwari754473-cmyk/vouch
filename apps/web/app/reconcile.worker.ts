import { executeBrowserRun, type RunRequest } from './source-workbench';

const scope = self as unknown as { onmessage: ((event: MessageEvent<RunRequest>) => void) | null; postMessage: (value: unknown) => void };
scope.onmessage = (event) => {
  try { scope.postMessage({ artifact: executeBrowserRun(event.data) }); }
  catch (error: unknown) { scope.postMessage({ error: error instanceof Error ? error.message : 'Reconciliation failed' }); }
};
