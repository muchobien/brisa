import { useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw, X } from "lucide-react";
import { Button, IconButton } from "../design-system/components";

export function PwaUpdates() {
  const [failed, setFailed] = useState(false);
  const [updating, setUpdating] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true, onNeedReload: () => {} });
  const reload = async () => {
    setUpdating(true);
    const activated = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", activated, { once: true });
    try {
      // Watch the browser event directly, including updates initiated by another tab.
      await updateServiceWorker(true);
    } catch {
      navigator.serviceWorker.removeEventListener("controllerchange", activated);
      setFailed(true);
      setUpdating(false);
    }
  };
  if (!needRefresh) return null;
  return (
    <aside className="pwa-update glass" role="status" aria-label="App update available">
      <RefreshCw size={19} />
      <div>
        <strong>A fresh version is ready.</strong>
        <p>
          {failed
            ? "Could not update. Please try again when connected."
            : "Reload whenever you’re ready."}
        </p>
      </div>
      <Button
        disabled={updating}
        onClick={() => {
          void reload();
        }}
      >
        Reload
      </Button>
      <IconButton label="Update later" onClick={() => setNeedRefresh(false)}>
        <X size={17} />
      </IconButton>
    </aside>
  );
}
