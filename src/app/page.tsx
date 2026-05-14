"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Cormorant_Garamond } from "next/font/google";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"]
});

const socket = io("http://localhost:4000");

type Message = {
  id?: string;
  messageId?: string;
  roomId: string;
  sender: "guest" | "staff";
  originalText: string;
  translatedText: string;
  timestamp: string;
};

export default function StaffChat() {
  const currentUser = "staff";

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [rooms, setRooms] = useState<string[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [unreadRooms, setUnreadRooms] = useState<string[]>([]);
  const [darkMode, setDarkMode] = useState(false);
  const [isTyping, setIsTyping] = useState(false);


  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    socket.on("activeRooms", (activeRooms: string[]) => {
      setRooms(activeRooms);
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
      if (data.roomId === selectedRoom) {
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
      if (data.sender === "guest" && data.roomId !== selectedRoom) {
        setUnreadRooms((prev) =>
          prev.includes(data.roomId) ? prev : [...prev, data.roomId]
        );
      }
    });
    socket.on("userTyping", () => {
      setIsTyping(true);
    });

    socket.on("userStopTyping", () => {
      setIsTyping(false);
    });

    fetch("http://localhost:4000/rooms")
      .then((res) => res.json())
      .then((data) => {
        setRooms(data.rooms || []);
      });

    return () => {
      socket.off("activeRooms");
      socket.off("chatHistory");
      socket.off("receiveMessage");
      socket.off("newRoomMessage");
      socket.off("userTyping");
      socket.off("userStopTyping");
    };
  }, [selectedRoom]);

  const openRoom = (roomId: string) => {
    setSelectedRoom(roomId);
    setUnreadRooms((prev) => prev.filter((room) => room !== roomId));

    socket.emit("joinRoom", {
      roomId,
      userType: currentUser
    });
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
            width: 320,
            padding: 30,
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

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16
            }}
          >
            {rooms.map((room) => {
              const isSelected = selectedRoom === room;
              const hasUnread = unreadRooms.includes(room);

              return (
                <button
                  key={room}
                  onClick={() => openRoom(room)}
                  style={{
                    padding: "20px 22px",
                    borderRadius: 20,
                    border: isSelected
                      ? "1px solid #C8A96A"
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
                      : hasUnread
                      ? "0 0 0 2px rgba(200,169,106,0.32)"
                      : "none"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10
                    }}
                  >
                    <span>Suite {room.replace("room-", "")}</span>

                    {hasUnread && (
                      <span
                        style={{
                          color: isSelected
                            ? "#2B241C"
                            : darkMode
                            ? "#E5D3A1"
                            : "#C8A96A",
                          fontSize: 12,
                          fontWeight: 900,
                          whiteSpace: "nowrap"
                        }}
                      >
                        ● Nuevo
                      </span>
                    )}
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
              : "Selecciona una suite"}
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
                  marginBottom: 18
                }}
              >
                <div
                  style={{
                    padding: "14px 18px",
                    borderRadius: 24,
                    background: darkMode
                      ? "linear-gradient(135deg, #2A241F 0%, #1E1A17 100%)"
                      : "linear-gradient(135deg, #FFFFFF 0%, #F7F2E8 100%)",
                    border: darkMode
                      ? "1px solid rgba(216,199,168,0.10)"
                      : "1px solid rgba(200,169,106,0.12)",
                    color: darkMode ? "#CDBFAD" : "#7A6A58",
                    fontSize: 14,
                    fontStyle: "italic",
                    boxShadow: darkMode
                      ? "0 12px 34px rgba(0,0,0,0.28)"
                      : "0 10px 30px rgba(90,70,40,0.06)"
                  }}
                >
                  Guest is typing...
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