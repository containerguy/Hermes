export function getPushSupport() {
  const isSecure = window.isSecureContext;
  const hasServiceWorker = "serviceWorker" in navigator;
  const hasPushManager = "PushManager" in window;
  const hasNotification = "Notification" in window;
  const permission = hasNotification ? Notification.permission : "unsupported";
  const hasApis = hasServiceWorker && hasPushManager && hasNotification;
  return {
    isSecure,
    hasServiceWorker,
    hasPushManager,
    hasNotification,
    permission,
    hasApis,
    canAttemptSubscribe: isSecure && hasApis
  };
}

export function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }
  return outputArray;
}
