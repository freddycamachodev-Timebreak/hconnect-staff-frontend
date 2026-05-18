"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cormorant_Garamond } from "next/font/google";
import { socket } from "@/lib/socket";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"]
});

const API_URL = "http://localhost:4000";

type Message = {
  id?: string;
  messageId?: string;
  roomId: string;
  sender: "guest" | "staff";
  originalText: string;
  translatedText: string;
  timestamp: string;
};

type Suite = {
  suiteId: string;
  roomId: string;
  status: string;
  updatedBy: string | null;
  updatedAt: string | null;
  priority: string;
  vip: boolean;
  lastMessageAt: string | null;
  unresolvedCount: number;
};

const statusConfig: Record<string, { label: string; color: string }> = {
  waiting: { label: "Waiting", color: "#F59E0B" },
  active: { label: "Active", color: "#22C55E" },
  pending: { label: "Pending", color: "#F97316" },
  resolved: { label: "Resolved", color: "#94A3B8" },
  checkout: { label: "Checkout", color: "#64748B" },
  offline: { label: "Offline", color: "#57534E" }
};

const operationalStatusLabel: Record<string, string> = {
  waiting: "○ Esperando",
  active: "● En atencion",
  pending: "◐ Pendiente",
  resolved: "✓ Resuelto",
  checkout: "↗ Checkout",
  offline: "○ Offline"
};

const statusWeight: Record<string, number> = {
  waiting: 0,
  pending: 1,
  active: 2,
  checkout: 3,
  resolved: 4,
  offline: 5
};

function normalizeRoomId(roomId: string) {
  return `room-${roomId.replace(/^room-/, "")}`;
}

function getMinutesWithoutResponse(suite: Suite, currentTime: number) {
  if (suite.unresolvedCount <= 0 || !suite.lastMessageAt) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor((currentTime - Date.parse(suite.lastMessageAt)) / 60000)
  );
}

function getSlaSortRank(suite: Suite, currentTime: number) {
  const minutesWithoutResponse = getMinutesWithoutResponse(suite, currentTime);

  if (minutesWithoutResponse > 30) return 4;
  if (minutesWithoutResponse > 15) return 3;
  if (minutesWithoutResponse >= 5) return 2;
  if (suite.unresolvedCount > 0) return 1;

  return 0;
}

function sortSuites(nextSuites: Suite[], currentTime = Date.now()) {
  return [...nextSuites].sort((a, b) => {
    const openWorkDiff =
      Number((b.unresolvedCount || 0) > 0) -
      Number((a.unresolvedCount || 0) > 0);

    if (openWorkDiff !== 0) {
      return openWorkDiff;
    }

    const slaDiff =
      getSlaSortRank(b, currentTime) - getSlaSortRank(a, currentTime);

    if (slaDiff !== 0) {
      return slaDiff;
    }

    if (Number(b.vip) !== Number(a.vip)) {
      return Number(b.vip) - Number(a.vip);
    }

    if ((b.unresolvedCount || 0) !== (a.unresolvedCount || 0)) {
      return (b.unresolvedCount || 0) - (a.unresolvedCount || 0);
    }

    const statusDiff =
      (statusWeight[a.status] ?? 99) - (statusWeight[b.status] ?? 99);

    if (statusDiff !== 0) {
      return statusDiff;
    }

    return Date.parse(b.lastMessageAt || "1970-01-01T00:00:00.000Z") -
      Date.parse(a.lastMessageAt || "1970-01-01T00:00:00.000Z");
  });
}

function dedupeSuites(nextSuites: Suite[]) {
  const uniqueSuites = Array.from(
    nextSuites.reduce((acc, suite) => {
      const roomId = normalizeRoomId(suite.roomId || suite.suiteId);
      const suiteId = roomId.replace(/^room-/, "");

      acc.set(suiteId, {
        ...suite,
        suiteId,
        roomId
      });

      return acc;
    }, new Map<string, Suite>()).values()
  );

  return sortSuites(uniqueSuites);
}

function getSlaState(suite: Suite, currentTime: number) {
  if (suite.unresolvedCount <= 0) {
    return {
      label: "Sin pendientes",
      color: "#22C55E",
      level: "ok"
    };
  }

  if (!suite.lastMessageAt) {
    return {
      label: "SLA pendiente",
      color: "#F97316",
      level: "warning"
    };
  }

  const minutesWithoutResponse = getMinutesWithoutResponse(suite, currentTime);

  if (minutesWithoutResponse > 30) {
    return {
      label: "SLA critico",
      color: "#EF4444",
      level: "critical"
    };
  }

  if (minutesWithoutResponse > 15) {
    return {
      label: "SLA alerta",
      color: "#F97316",
      level: "warning"
    };
  }

  if (minutesWithoutResponse >= 5) {
    return {
      label: "SLA atencion",
      color: "#F59E0B",
      level: "attention"
    };
  }

  return {
    label: "SLA OK",
    color: "#22C55E",
    level: "new"
  };
}

export default function StaffChat() {
  const currentUser = "staff";

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [suites, setSuites] = useState<Suite[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [unreadRooms, setUnreadRooms] = useState<string[]>([]);
  const [recentActivityRooms, setRecentActivityRooms] = useState<string[]>([]);
  const [activityNotice, setActivityNotice] = useState<{
    roomId: string;
    suiteId: string;
    reason: string;
  } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const selectedRoomRef = useRef<string | null>(null);
  const highlightTimeoutsRef = useRef<Record<string, number>>({});
  const noticeTimeoutRef = useRef<number | null>(null);
  const suitesSnapshotRef = useRef<Map<string, Suite>>(new Map());

  const orderedSuites = useMemo(
    () => sortSuites(suites, currentTime),
    [suites, currentTime]
  );
  const selectedSuite = suites.find((suite) => suite.roomId === selectedRoom);
  const dashboardMetrics = useMemo(() => {
    return suites.reduce(
      (metrics, suite) => {
        const slaState = getSlaState(suite, currentTime);

        if (suite.status === "active") {
          metrics.active += 1;
        }

        if (suite.status === "pending") {
          metrics.pending += 1;
        }

        if (suite.status === "waiting") {
          metrics.waiting += 1;
        }

        if (suite.vip) {
          metrics.vip += 1;
        }

        if (suite.unresolvedCount > 0 && slaState.level === "critical") {
          metrics.critical += 1;
        }

        return metrics;
      },
      {
        active: 0,
        pending: 0,
        waiting: 0,
        vip: 0,
        critical: 0
      }
    );
  }, [suites, currentTime]);
  const selectedSuiteSla = selectedSuite
    ? getSlaState(selectedSuite, currentTime)
    : null;

  const playNotificationSound = useCallback((urgent = false) => {
    if (!soundEnabled) {
      return;
    }

    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;

    if (!AudioContextClass) {
      return;
    }

    const audioContext = new AudioContextClass();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(urgent ? 880 : 620, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      urgent ? 660 : 520,
      audioContext.currentTime + 0.18
    );
    gain.gain.setValueAtTime(0.001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.22);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.24);

    window.setTimeout(() => {
      audioContext.close().catch(() => undefined);
    }, 300);
  }, [soundEnabled]);

  const highlightSuite = useCallback((roomId: string, reason = "Nueva actividad") => {
    const normalizedRoomId = normalizeRoomId(roomId);

    if (normalizedRoomId === selectedRoomRef.current) {
      return;
    }

    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
    }

    setActivityNotice({
      roomId: normalizedRoomId,
      suiteId: normalizedRoomId.replace(/^room-/, ""),
      reason
    });

    noticeTimeoutRef.current = window.setTimeout(() => {
      setActivityNotice(null);
      noticeTimeoutRef.current = null;
    }, 5000);
    playNotificationSound(reason.includes("VIP") || reason.includes("SLA"));

    setRecentActivityRooms((prev) =>
      prev.includes(normalizedRoomId) ? prev : [...prev, normalizedRoomId]
    );

    window.clearTimeout(highlightTimeoutsRef.current[normalizedRoomId]);
    highlightTimeoutsRef.current[normalizedRoomId] = window.setTimeout(() => {
      setRecentActivityRooms((prev) =>
        prev.filter((activeRoom) => activeRoom !== normalizedRoomId)
      );
      delete highlightTimeoutsRef.current[normalizedRoomId];
    }, 5000);
  }, [playNotificationSound]);

  const syncQueue = useCallback((nextSuites: Suite[]) => {
    const normalizedSuites = dedupeSuites(nextSuites);
    const previousSuites = suitesSnapshotRef.current;
    const hasPreviousSnapshot = previousSuites.size > 0;
    const nextSnapshot = new Map<string, Suite>();

    normalizedSuites.forEach((suite) => {
      const previousSuite = previousSuites.get(suite.suiteId);
      const hasNewPending =
        previousSuite &&
        (suite.unresolvedCount || 0) > (previousSuite.unresolvedCount || 0);
      const reason = !previousSuite
        ? "Nueva suite"
        : hasNewPending || previousSuite.lastMessageAt !== suite.lastMessageAt
        ? "Nuevo mensaje"
        : "Status actualizado";

      if (
        hasPreviousSnapshot &&
        (
          !previousSuite ||
          previousSuite.status !== suite.status ||
          previousSuite.unresolvedCount !== suite.unresolvedCount ||
          previousSuite.lastMessageAt !== suite.lastMessageAt
        )
      ) {
        highlightSuite(suite.roomId, reason);
      }

      nextSnapshot.set(suite.suiteId, suite);
    });

    suitesSnapshotRef.current = nextSnapshot;
    setSuites(normalizedSuites);
  }, [highlightSuite]);

  const fetchQueue = useCallback(async () => {
    const response = await fetch(`${API_URL}/suites/queue`);
    const data = await response.json();

    syncQueue(data.suites || []);
  }, [syncQueue]);

  useEffect(() => {
    selectedRoomRef.current = selectedRoom;
  }, [selectedRoom]);

  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }

    socket.on("activeRooms", () => {
      fetchQueue().catch((error) => {
        console.error("Error loading suite queue:", error);
      });
    });

    socket.on("queueUpdated", (updatedSuites: Suite[]) => {
      syncQueue(updatedSuites);
    });

    socket.on("chatHistory", (history: Message[]) => {
      setMessages(history);

      setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop =
            messagesContainerRef.current.scrollHeight;
        }
      }, 100);
    });

    socket.on("receiveMessage", (data: Message) => {
      if (data.roomId === selectedRoomRef.current) {
        setMessages((prev) => [...prev, data]);

        setTimeout(() => {
          if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop =
              messagesContainerRef.current.scrollHeight;
          }
        }, 100);
      }
    });

    socket.on("newRoomMessage", (data: Message) => {
      const roomId = normalizeRoomId(data.roomId);

      if (data.sender === "guest" && roomId !== selectedRoomRef.current) {
        setUnreadRooms((prev) =>
          prev.includes(roomId) ? prev : [...prev, roomId]
        );

        highlightSuite(roomId, "Nuevo mensaje");
      }
    });
    socket.on("userTyping", () => {
      setIsTyping(true);
    });

    socket.on("userStopTyping", () => {
      setIsTyping(false);
    });

    const queueTimeoutId = window.setTimeout(() => {
      fetchQueue().catch((error) => {
        console.error("Error loading suite queue:", error);
      });
    }, 0);

    const clockTimeoutId = window.setTimeout(() => {
      setCurrentTime(Date.now());
    }, 0);

    const clockIntervalId = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, 60000);
    const highlightTimeouts = highlightTimeoutsRef.current;

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      window.clearTimeout(queueTimeoutId);
      window.clearTimeout(clockTimeoutId);
      window.clearInterval(clockIntervalId);
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
      Object.values(highlightTimeouts).forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });

      socket.off("activeRooms");
      socket.off("queueUpdated");
      socket.off("chatHistory");
      socket.off("receiveMessage");
      socket.off("newRoomMessage");
      socket.off("userTyping");
      socket.off("userStopTyping");
      socket.disconnect();
    };
  }, [fetchQueue, highlightSuite, syncQueue]);

  const updateSuiteStatus = async (roomId: string, status: string) => {
    const suiteId = roomId.replace(/^room-/, "");

    try {
      const response = await fetch(`${API_URL}/suites/${suiteId}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          status,
          roomId,
          updatedBy: currentUser
        })
      });

      if (!response.ok) {
        throw new Error("Suite status update failed");
      }

      const updatedSuite = await response.json();

      setSuites((prev) =>
        dedupeSuites(
          prev.map((suite) =>
            suite.roomId === roomId ? { ...suite, ...updatedSuite } : suite
          )
        )
      );
    } catch (error) {
      console.error("Error updating suite status:", error);
    }
  };

  const updateSuiteVip = async (roomId: string, vip: boolean) => {
    const currentSuite = suites.find((suite) => suite.roomId === roomId);

    if (!currentSuite) {
      return;
    }

    const suiteId = roomId.replace(/^room-/, "");

    try {
      const response = await fetch(`${API_URL}/suites/${suiteId}/status`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          status: currentSuite.status,
          roomId,
          updatedBy: currentUser,
          vip
        })
      });

      if (!response.ok) {
        throw new Error("Suite VIP update failed");
      }

      const updatedSuite = await response.json();

      setSuites((prev) =>
        dedupeSuites(
          prev.map((suite) =>
            suite.roomId === roomId ? { ...suite, ...updatedSuite } : suite
          )
        )
      );
    } catch (error) {
      console.error("Error updating suite VIP:", error);
    }
  };

    const openRoom = (roomId: string, currentStatus?: string) => {
      setSelectedRoom(roomId);

      setUnreadRooms((prev) =>
        prev.filter((room) => room !== roomId)
      );
      setRecentActivityRooms((prev) =>
        prev.filter((room) => room !== roomId)
      );
      if (activityNotice?.roomId === roomId) {
        setActivityNotice(null);
      }
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current);
        noticeTimeoutRef.current = null;
      }
      window.clearTimeout(highlightTimeoutsRef.current[roomId]);
      delete highlightTimeoutsRef.current[roomId];

      socket.emit("joinRoom", {
        roomId,
        userType: currentUser
      });

      if (currentStatus === "waiting" || currentStatus === "pending") {
        updateSuiteStatus(roomId, "active");
      }
    };

  const sendMessage = () => {
    if (!message.trim() || !selectedRoom) return;

    socket.emit("sendMessage", {
      roomId: selectedRoom,
      sender: currentUser,
      text: message
    });

    setMessage("");
  };

  const formatHour = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const formatRelativeTime = (timestamp: string | null) => {
    if (!timestamp) {
      return "Sin actividad";
    }

    const diffMinutes = Math.max(
      0,
      Math.floor((currentTime - new Date(timestamp).getTime()) / 60000)
    );

    if (diffMinutes < 1) {
      return "Ahora";
    }

    if (diffMinutes < 60) {
      return `Hace ${diffMinutes} min`;
    }

    return `Hace ${Math.floor(diffMinutes / 60)} h`;
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 40,
        transition: "all 0.35s ease",
        background: darkMode
          ? "radial-gradient(circle at top left, rgba(200,169,106,0.18), transparent 28%), linear-gradient(135deg, #161311 0%, #1E1A17 48%, #2A241F 100%)"
          : "radial-gradient(circle at top left, rgba(200,169,106,0.28), transparent 28%), linear-gradient(135deg, #FFFDF8 0%, #F7F2E8 45%, #E8DCC8 100%)"
      }}
    >
      <style>
        {`
          @keyframes hconnectQueuePulse {
            0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.46); }
            70% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
            100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
          }

          .hconnect-suite-queue {
            scrollbar-width: thin;
            scrollbar-color: rgba(122, 106, 88, 0.38) transparent;
          }

          .hconnect-suite-queue::-webkit-scrollbar {
            width: 8px;
          }

          .hconnect-suite-queue::-webkit-scrollbar-track {
            background: transparent;
          }

          .hconnect-suite-queue::-webkit-scrollbar-thumb {
            background: rgba(122, 106, 88, 0.30);
            border-radius: 999px;
          }

          .hconnect-suite-queue::-webkit-scrollbar-thumb:hover {
            background: rgba(122, 106, 88, 0.48);
          }
        `}
      </style>
      {activityNotice && (
        <button
          onClick={() => openRoom(activityNotice.roomId)}
          style={{
            position: "fixed",
            top: 28,
            right: 28,
            zIndex: 20,
            border: darkMode
              ? "1px solid rgba(34,197,94,0.45)"
              : "1px solid rgba(34,197,94,0.35)",
            borderRadius: 16,
            padding: "12px 16px",
            background: darkMode
              ? "linear-gradient(135deg, #16251B 0%, #211D18 100%)"
              : "linear-gradient(135deg, #F0FDF4 0%, #FFFDF8 100%)",
            color: darkMode ? "#F5EAD7" : "#2B241C",
            boxShadow: "0 18px 42px rgba(34,197,94,0.22)",
            cursor: "pointer",
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            minWidth: 210
          }}
        >
          <span
            style={{
              color: "#22C55E",
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: 0
            }}
          >
            ● NUEVO
          </span>
          <strong style={{ fontSize: 16 }}>Suite {activityNotice.suiteId}</strong>
          <span
            style={{
              color: darkMode ? "#B8A88F" : "#7A6A58",
              fontSize: 12,
              fontWeight: 800
            }}
          >
            {activityNotice.reason}
          </span>
        </button>
      )}
      <section
        style={{
          width: "100%",
          maxWidth: 1400,
          height: "92vh",
          display: "flex",
          overflow: "hidden",
          borderRadius: 34,
          background: darkMode ? "rgba(36,31,27,0.86)" : "#FFFDF8",
          backdropFilter: "blur(18px)",
          border: darkMode
            ? "1px solid rgba(216,199,168,0.16)"
            : "1px solid rgba(200,169,106,0.25)",
          boxShadow: darkMode
            ? "0 30px 90px rgba(0,0,0,0.42), 0 0 80px rgba(200,169,106,0.08)"
            : "0 30px 80px rgba(90,70,40,0.18)",
          transition: "all 0.35s ease"
        }}
      >
        <aside
          style={{
            width: 360,
            padding: 30,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            background: darkMode
              ? "linear-gradient(180deg, #1E1A17 0%, #161311 100%)"
              : "linear-gradient(180deg, #F7F2E8 0%, #EFE4D2 100%)",
            borderRight: darkMode
              ? "1px solid rgba(216,199,168,0.14)"
              : "1px solid rgba(200,169,106,0.2)",
            transition: "all 0.35s ease"
          }}
        >
          <h1
            className={cormorant.className}
            style={{
              fontSize: 54,
              fontWeight: 500,
              color: darkMode ? "#F5EAD7" : "#2B241C",
              letterSpacing: 1
            }}
          >
            HConnect
          </h1>

          <p
            style={{
              color: darkMode ? "#B8A88F" : "#7A6A58",
              marginTop: 6,
              marginBottom: 20,
              fontSize: 15
            }}
          >
            Concierge Staff Panel
          </p>

          <button
            onClick={() => setDarkMode(!darkMode)}
            style={{
              width: "100%",
              marginBottom: 28,
              padding: "16px 18px",
              borderRadius: 18,
              border: darkMode
                ? "1px solid rgba(216,199,168,0.22)"
                : "1px solid rgba(200,169,106,0.25)",
              background: darkMode
                ? "linear-gradient(135deg, #2A241F 0%, #1E1A17 100%)"
                : "#FFFDF8",
              color: darkMode ? "#F5EAD7" : "#2B241C",
              cursor: "pointer",
              fontWeight: 700,
              transition: "all 0.35s ease",
              boxShadow: darkMode
                ? "0 10px 28px rgba(0,0,0,0.32)"
                : "0 10px 24px rgba(90,70,40,0.08)"
            }}
          >
            {darkMode ? "☀ Light Mode" : "🌙 Dark Mode"}
          </button>

          <button
            onClick={() => setSoundEnabled((enabled) => !enabled)}
            style={{
              width: "100%",
              marginBottom: 18,
              padding: "14px 18px",
              borderRadius: 18,
              border: soundEnabled
                ? "1px solid rgba(34,197,94,0.45)"
                : darkMode
                ? "1px solid rgba(216,199,168,0.22)"
                : "1px solid rgba(200,169,106,0.25)",
              background: soundEnabled
                ? "linear-gradient(135deg, #DCFCE7 0%, #FFFDF8 100%)"
                : darkMode
                ? "linear-gradient(135deg, #2A241F 0%, #1E1A17 100%)"
                : "#FFFDF8",
              color: soundEnabled
                ? "#166534"
                : darkMode
                ? "#F5EAD7"
                : "#2B241C",
              cursor: "pointer",
              fontWeight: 700,
              transition: "all 0.35s ease",
              boxShadow: soundEnabled
                ? "0 10px 24px rgba(34,197,94,0.14)"
                : darkMode
                ? "0 10px 28px rgba(0,0,0,0.32)"
                : "0 10px 24px rgba(90,70,40,0.08)"
            }}
          >
            {soundEnabled ? "Sonido activo" : "Sonido apagado"}
          </button>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginBottom: 24
            }}
          >
            {[
              { label: "Activas", value: dashboardMetrics.active, color: "#22C55E" },
              { label: "Pendientes", value: dashboardMetrics.pending, color: "#F97316" },
              { label: "Waiting", value: dashboardMetrics.waiting, color: "#F59E0B" },
              { label: "VIP", value: dashboardMetrics.vip, color: "#C8A96A" },
              { label: "Críticas", value: dashboardMetrics.critical, color: "#EF4444" }
            ].map((metric) => (
              <div
                key={metric.label}
                style={{
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: darkMode ? "rgba(42,36,31,0.72)" : "#FFFDF8",
                  border: darkMode
                    ? "1px solid rgba(216,199,168,0.14)"
                    : "1px solid rgba(200,169,106,0.18)",
                  boxShadow: darkMode
                    ? "0 8px 24px rgba(0,0,0,0.18)"
                    : "0 8px 20px rgba(90,70,40,0.06)"
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 900,
                    color: darkMode ? "#B8A88F" : "#7A6A58",
                    textTransform: "uppercase"
                  }}
                >
                  {metric.label}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 24,
                    lineHeight: 1,
                    fontWeight: 900,
                    color: metric.color
                  }}
                >
                  {metric.value}
                </div>
              </div>
            ))}
          </div>

          <div
            className="hconnect-suite-queue"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              paddingRight: 14,
              marginRight: -8
            }}
          >
            {orderedSuites.map((suite) => {
              const room = suite.roomId;
              const isSelected = selectedRoom === room;
              const hasPending =
                unreadRooms.includes(room) || suite.unresolvedCount > 0;
              const isRecentlyActive = recentActivityRooms.includes(room);
              const operationalStatus =
                statusConfig[suite.status] || statusConfig.waiting;
              const slaState = getSlaState(suite, currentTime);
              const isSlaCritical =
                suite.unresolvedCount > 0 && slaState.level === "critical";

              return (
                <button
                  key={suite.suiteId}
                  onClick={() => openRoom(room, suite.status)}
                  style={{
                    minHeight: 88,
                    padding: "14px 18px",
                    borderRadius: 14,
                    border: isSelected
                      ? "1px solid #C8A96A"
                      : hasPending
                      ? `1px solid ${slaState.color}`
                      : darkMode
                      ? "1px solid rgba(216,199,168,0.14)"
                      : "1px solid rgba(200,169,106,0.15)",
                    background: isSelected
                      ? darkMode
                        ? "linear-gradient(135deg, #C8A96A 0%, #E5D3A1 100%)"
                        : "linear-gradient(135deg, #D8C7A8 0%, #F3E8D3 100%)"
                      : darkMode
                      ? "linear-gradient(135deg, #2A241F 0%, #241F1B 100%)"
                      : "#FFFDF8",
                    color: isSelected
                      ? "#2B241C"
                      : darkMode
                      ? "#F5EAD7"
                      : "#2B241C",
                    cursor: "pointer",
                    fontWeight: 700,
                    textAlign: "left",
                    transition: "all 0.25s ease",
                    boxShadow: isSelected
                      ? darkMode
                        ? "0 10px 34px rgba(200,169,106,0.24)"
                        : "0 10px 30px rgba(200,169,106,0.22)"
                      : hasPending
                      ? `0 0 0 2px ${slaState.color}44, 0 12px 34px ${slaState.color}2E`
                      : "none",
                    animation: isRecentlyActive && !isSelected
                      ? "hconnectQueuePulse 1.8s infinite"
                      : "none"
                  }}
                >
                  <div
  style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14
  }}
>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minWidth: 0
            }}
          >
            <span
              style={{
                fontSize: 16,
                lineHeight: 1.15,
                whiteSpace: "nowrap"
              }}
            >
              Suite {room.replace("room-", "")}
            </span>

            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: isSelected ? "#2B241C" : operationalStatus.color,
                whiteSpace: "nowrap"
              }}
            >
              {operationalStatusLabel[suite.status] || operationalStatusLabel.waiting}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 5,
              flexShrink: 0
            }}
          >
          {(isRecentlyActive || suite.vip || isSlaCritical) && (
            <span
              style={{
                color: isSelected
                  ? "#2B241C"
                  : darkMode
                  ? "#F5EAD7"
                  : isRecentlyActive
                  ? "#15803D"
                  : isSlaCritical
                  ? "#B91C1C"
                  : "#7F1D1D",
                fontSize: 10,
                fontWeight: 900,
                whiteSpace: "nowrap",
                padding: "3px 7px",
                borderRadius: 999,
                background: isSelected
                  ? "rgba(43,36,28,0.10)"
                  : `${slaState.color}22`,
                border: isSelected
                  ? "1px solid rgba(43,36,28,0.12)"
                  : `1px solid ${slaState.color}66`
              }}
            >
              {isSlaCritical
                ? "SLA CRITICO"
                : isRecentlyActive && suite.vip
                ? "● NUEVO · VIP"
                : isRecentlyActive
                ? "● NUEVO"
                : "VIP"}
            </span>
          )}
            <span
              style={{
                color: isSelected ? "#2B241C" : operationalStatus.color,
                fontSize: 11,
                fontWeight: 900,
                whiteSpace: "nowrap"
              }}
            >
              {operationalStatus.label}
            </span>
            <span
              style={{
                color: isSelected
                  ? "#2B241C"
                  : darkMode
                  ? "#B8A88F"
                  : "#7A6A58",
                fontSize: 11,
                fontWeight: 800,
                whiteSpace: "nowrap"
              }}
            >
              {suite.unresolvedCount} pendientes
            </span>

            {suite.unresolvedCount > 0 ? (
              <span
                style={{
                  color: isSelected
                    ? "#2B241C"
                    : slaState.color,
                  fontSize: 11,
                  fontWeight: 900,
                  whiteSpace: "nowrap"
                }}
              >
                {formatRelativeTime(suite.lastMessageAt)}
              </span>
            ) : (
              <span
                style={{
                  color: isSelected
                    ? "#2B241C"
                    : darkMode
                    ? "#9B8A75"
                    : "#8A7A66",
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: "nowrap"
                }}
              >
                Sin pendientes
              </span>
            )}
          </div>
        </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: 34,
            transition: "all 0.35s ease"
          }}
        >
          <h2
            className={cormorant.className}
            style={{
              fontSize: 64,
              color: darkMode ? "#F5EAD7" : "#2B241C",
              fontWeight: 500
            }}
          >
            {selectedRoom
              ? `Suite ${selectedRoom.replace("room-", "")}`
              : suites.length > 0
              ? "Selecciona una suite"
              : "No hay conversaciones activas"}
          </h2>

          <p
            style={{
              color: darkMode ? "#B8A88F" : "#7A6A58",
              marginTop: 6,
              marginBottom: 24,
              fontSize: 18
            }}
          >
            Atención personalizada al huésped
          </p>
          {!selectedRoom && suites.length === 0 && (
            <p
              style={{
                color: darkMode ? "#9B8A75" : "#8A7A66",
                marginBottom: 24,
                fontSize: 15,
                fontWeight: 700
              }}
            >
              Las nuevas solicitudes apareceran aqui en tiempo real.
            </p>
          )}
          {selectedSuite && (
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                marginBottom: 18,
                color: darkMode ? "#CDBFAD" : "#7A6A58",
                fontSize: 13,
                fontWeight: 800
              }}
            >
              <span style={{ color: statusConfig[selectedSuite.status]?.color }}>
                {statusConfig[selectedSuite.status]?.label || selectedSuite.status}
              </span>
              <span>{selectedSuite.unresolvedCount} pendientes</span>
              {selectedSuite.unresolvedCount > 0 ? (
                <span>{formatRelativeTime(selectedSuite.lastMessageAt)}</span>
              ) : (
                <span>Última actividad</span>
              )}
              {selectedSuiteSla && selectedSuite.unresolvedCount > 0 && (
                <span
                  style={{
                    color: selectedSuiteSla.color,
                    padding: "4px 8px",
                    borderRadius: 999,
                    background: `${selectedSuiteSla.color}16`,
                    border: `1px solid ${selectedSuiteSla.color}44`
                  }}
                >
                  {selectedSuiteSla.label}
                </span>
              )}
              {selectedSuite.vip && (
                <span
                  style={{
                    color: "#A16207",
                    padding: "4px 8px",
                    borderRadius: 999,
                    background: "rgba(200,169,106,0.16)",
                    border: "1px solid rgba(200,169,106,0.34)"
                  }}
                >
                  VIP
                </span>
              )}
            </div>
          )}
          {selectedRoom && (
            <div
              style={{
                display: "flex",
                gap: 10,
                marginBottom: 20,
                flexWrap: "wrap"
              }}
            >
              <button
                onClick={() => updateSuiteStatus(selectedRoom, "active")}
                style={{
                  padding: "10px 16px",
                  borderRadius: 14,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 700,
                  background: "#22c55e",
                  color: "#fff"
                }}
              >
                En atención
              </button>

              <button
                onClick={() => updateSuiteStatus(selectedRoom, "pending")}
                style={{
                  padding: "10px 16px",
                  borderRadius: 14,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 700,
                  background: "#F97316",
                  color: "#fff"
                }}
              >
                Pendiente
              </button>

              <button
                onClick={() => updateSuiteStatus(selectedRoom, "resolved")}
                style={{
                  padding: "10px 16px",
                  borderRadius: 14,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 700,
                  background: "#94A3B8",
                  color: "#fff"
                }}
              >
                Resuelto
              </button>

              <button
                onClick={() => updateSuiteStatus(selectedRoom, "checkout")}
                style={{
                  padding: "10px 16px",
                  borderRadius: 14,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 700,
                  background: "#64748B",
                  color: "#fff"
                }}
              >
                Checkout
              </button>

              <button
                onClick={() => updateSuiteStatus(selectedRoom, "offline")}
                style={{
                  padding: "10px 16px",
                  borderRadius: 14,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 700,
                  background: "#57534E",
                  color: "#fff"
                }}
              >
                Offline
              </button>

              <button
                onClick={() => updateSuiteStatus(selectedRoom, "waiting")}
                style={{
                  padding: "10px 16px",
                  borderRadius: 14,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 700,
                  background: "#C8A96A",
                  color: "#2B241C"
                }}
              >
                Reabrir
              </button>

              {selectedSuite && (
                <button
                  onClick={() => updateSuiteVip(selectedRoom, !selectedSuite.vip)}
                  style={{
                    padding: "10px 16px",
                    borderRadius: 14,
                    border: selectedSuite.vip
                      ? "1px solid rgba(161,98,7,0.35)"
                      : "1px solid rgba(200,169,106,0.35)",
                    cursor: "pointer",
                    fontWeight: 700,
                    background: selectedSuite.vip
                      ? "linear-gradient(135deg, #FDE68A 0%, #D6B66C 100%)"
                      : "transparent",
                    color: selectedSuite.vip
                      ? "#2B241C"
                      : darkMode
                      ? "#F5EAD7"
                      : "#7A5C1E"
                  }}
                >
                  {selectedSuite.vip ? "VIP activo" : "Marcar VIP"}
                </button>
              )}
            </div>
          )}
          <div
            ref={messagesContainerRef}
            style={{
              flex: 1,
              overflowY: "auto",
              scrollBehavior: "smooth",
              borderRadius: 28,
              padding: 26,
              background: darkMode
                ? "radial-gradient(circle at top left, rgba(200,169,106,0.08), transparent 25%), linear-gradient(180deg, #181411 0%, #12100E 100%)"
                : "radial-gradient(circle at top left, rgba(216,199,168,0.25), transparent 25%), linear-gradient(180deg, #FFFDF8 0%, #F7F2E8 100%)",
              border: darkMode
                ? "1px solid rgba(216,199,168,0.12)"
                : "1px solid rgba(200,169,106,0.16)",
              boxShadow: darkMode
                ? "inset 0 0 40px rgba(0,0,0,0.22)"
                : "none",
              transition: "all 0.35s ease"
            }}
          >
            {messages.map((msg) => {
              const isMine = msg.sender === currentUser;

              return (
                <div
                  key={
                    msg.id ||
                    msg.messageId ||
                    `${msg.roomId}-${msg.timestamp}`
                  }
                  style={{
                    display: "flex",
                    justifyContent: isMine ? "flex-end" : "flex-start",
                    marginBottom: 18
                  }}
                >
                  <div
                    style={{
                      maxWidth: "62%",
                      padding: "18px 20px",
                      borderRadius: 24,
                      background: isMine
                        ? darkMode
                          ? "linear-gradient(135deg, #C8A96A 0%, #E5D3A1 100%)"
                          : "linear-gradient(135deg, #D8C7A8 0%, #F3E8D3 100%)"
                        : darkMode
                        ? "linear-gradient(135deg, #2A241F 0%, #1E1A17 100%)"
                        : "linear-gradient(135deg, #FFFFFF 0%, #F7F2E8 100%)",
                      border: darkMode
                        ? "1px solid rgba(216,199,168,0.10)"
                        : "1px solid rgba(200,169,106,0.12)",
                      boxShadow: darkMode
                        ? "0 12px 34px rgba(0,0,0,0.28)"
                        : "0 10px 30px rgba(90,70,40,0.06)",
                      transition: "all 0.35s ease"
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        color: isMine
                          ? "#2B241C"
                          : darkMode
                          ? "#CDBFAD"
                          : "#7A6A58",
                        marginBottom: 8,
                        fontWeight: 700
                      }}
                    >
                      {isMine ? "Concierge" : "Guest"}
                    </div>

                    <div
                      style={{
                        lineHeight: 1.7,
                        color: isMine
                          ? "#2B241C"
                          : darkMode
                          ? "#F5EAD7"
                          : "#2B241C",
                        fontSize: 18
                      }}
                    >
                      {msg.sender === currentUser
                        ? msg.originalText
                        : msg.translatedText}
                    </div>

                    <div
                      style={{
                        fontSize: 12,
                        color: isMine
                          ? "#2B241C"
                          : darkMode
                          ? "#9B8A75"
                          : "#9C8A74",
                        textAlign: "right",
                        marginTop: 10,
                        opacity: 0.75
                      }}
                    >
                      {formatHour(msg.timestamp)}
                    </div>
                  </div>
                </div>
              );
            })}
        {isTyping && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-start",
              marginBottom: 18,
              animation: "fadeIn 0.2s ease"
            }}
          >
            <div
              style={{
                maxWidth: 220,
                padding: "16px 18px",
                borderRadius: 24,
                background: darkMode
                  ? "linear-gradient(135deg, #2A241F 0%, #1E1A17 100%)"
                  : "linear-gradient(135deg, #FFFFFF 0%, #F7F2E8 100%)",
                border: darkMode
                  ? "1px solid rgba(216,199,168,0.10)"
                  : "1px solid rgba(200,169,106,0.12)",
                boxShadow: darkMode
                  ? "0 12px 34px rgba(0,0,0,0.28)"
                  : "0 10px 30px rgba(90,70,40,0.06)"
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: darkMode ? "#CDBFAD" : "#7A6A58",
                  marginBottom: 6,
                  fontWeight: 700
                }}
              >
                Guest
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: darkMode ? "#F5EAD7" : "#7A6A58",
                  fontSize: 15,
                  fontStyle: "italic"
                }}
              >
                typing...

                <span
                  style={{
                    animation: "blink 1s infinite"
                  }}
                >
                  ●
                </span>
              </div>
            </div>
          </div>
        )}
          </div>

          <div
            style={{
              display: "flex",
              gap: 18,
              marginTop: 24
            }}
          >
            <input
              disabled={!selectedRoom}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);

                if (!selectedRoom) return;

                socket.emit("typing", {
                  roomId: selectedRoom,
                  sender: currentUser
                });

                if (typingTimeoutRef.current) {
                  clearTimeout(typingTimeoutRef.current);
                }

                typingTimeoutRef.current = setTimeout(() => {
                  socket.emit("stopTyping", {
                    roomId: selectedRoom
                  });
                }, 1200);
              }}              
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder={
                selectedRoom
                  ? `Responder a suite ${selectedRoom.replace("room-", "")}...`
                  : "Selecciona una conversación..."
              }
              style={{
                flex: 1,
                padding: 22,
                borderRadius: 20,
                border: darkMode
                  ? "1px solid rgba(216,199,168,0.12)"
                  : "1px solid rgba(200,169,106,0.2)",
                background: darkMode ? "#181411" : "#FFFDF8",
                color: darkMode ? "#F5EAD7" : "#2B241C",
                fontSize: 17,
                outline: "none",
                transition: "all 0.35s ease"
              }}
            />

            <button
              disabled={!selectedRoom}
              onClick={sendMessage}
              style={{
                padding: "0 34px",
                borderRadius: 20,
                border: "none",
                background: selectedRoom
                  ? darkMode
                    ? "linear-gradient(135deg, #C8A96A 0%, #E5D3A1 100%)"
                    : "linear-gradient(135deg, #D8C7A8 0%, #F3E8D3 100%)"
                  : darkMode
                  ? "#3A332D"
                  : "#D8C7A8",
                color: "#2B241C",
                fontWeight: 700,
                fontSize: 18,
                cursor: selectedRoom ? "pointer" : "not-allowed",
                boxShadow: selectedRoom
                  ? "0 10px 30px rgba(200,169,106,0.24)"
                  : "none",
                transition: "all 0.35s ease"
              }}
            >
              Enviar
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
