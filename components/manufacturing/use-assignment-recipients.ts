import { useEffect, useState } from "react";
import { type Api, message } from "@/lib/manufacturing/api";
import type { AssignmentRecipients, CachedState } from "@/lib/manufacturing/types";

export function useAssignmentRecipients(api: Api, state: CachedState, enabled: boolean) {
  const { context, catalog, lastSync } = state;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    context: typeof context;
    catalog: typeof catalog;
    lastSync: typeof lastSync;
    revision: number;
    scope: AssignmentRecipients;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const accept = (scope: AssignmentRecipients) => {
      if (!cancelled) setResult({ context, catalog, lastSync, revision, scope });
    };
    void api.assignmentRecipients().then(accept, (error) => accept({
      can_manage: false,
      reason: `Could not refresh assignment access. Reconnect and try again. ${message(error)}`,
      recipients: [],
    }));
    return () => { cancelled = true; };
  }, [api, enabled, context, catalog, lastSync, revision]);
  // Hide stale choices immediately while a new context is being checked.
  const scope = enabled && result?.context === context && result.catalog === catalog &&
    result.lastSync === lastSync && result.revision === revision ? result.scope : null;
  return { scope, reloadRecipients: () => setRevision((r) => r + 1) };
}
