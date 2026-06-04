import { io } from "socket.io-client";
import { API_URL } from "@/lib/api";

function getClientId() {
  if (typeof window === "undefined") {
    return "staff-server";
  }

  const storageKey = "hconnect-staff-socket-client-id";
  const savedClientId = window.sessionStorage.getItem(storageKey);

  if (savedClientId) {
    return savedClientId;
  }

  const clientId = crypto.randomUUID();
  window.sessionStorage.setItem(storageKey, clientId);

  return clientId;
}

export const socket = io(API_URL, {
  autoConnect: false,
  auth: (callback) => {
    callback({
      clientId: getClientId()
    });
  }
});
